/**
 * Netlify Scheduled Background Function — daily-scheduler-background
 *
 * Runs every day at 13:00 UTC (= 5 AM PST / 6 AM PDT).
 * For each posting slot configured in gotjesus_posting_settings:
 *   1. Check for duplicate — skip if a scheduled reel already exists for this slot.
 *   2. Create a gotjesus_reels row (status="generating", source="scheduled").
 *   3. Submit a Kie.ai Seedance 2.0 job for the branded 8-second reel.
 *   4. Poll Kie until the video is ready (up to ~10 minutes).
 *   5. Download + upload video to Supabase Storage.
 *   6. Publish to Blotato with scheduledTime = the Pacific posting slot in UTC.
 *   7. Update the DB row with Blotato submission IDs and status="scheduled".
 *
 * All helpers are inlined because Netlify background functions are bundled
 * separately and cannot resolve @/ path aliases.
 *
 * Max runtime: 15 minutes (Netlify background function limit).
 * With 5 posts/day at ~3 minutes each, 5 posts should complete in ~15 min.
 * If you need more posts, split across two scheduler runs.
 */

import type { Handler } from "@netlify/functions";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ─── Config (inlined) ─────────────────────────────────────────────────────────

const KIE_BASE_URL = "https://api.kie.ai";
const BLOTATO_BASE_URL = "https://backend.blotato.com";
const BUCKET = process.env.SUPABASE_VIDEO_BUCKET || "GOT JESUS";
const FOLDER = process.env.SUPABASE_VIDEO_FOLDER || "gotjesus-videos";
const GOT_JESUS_CAPTION = "Jesus Loves You! \n#jesus #gotjesus gotjesus.co";
const CROSS_DISCOVERY_PROMPT = `Vertical 9:16 social media video. Fast-paced cross discovery montage. Show diverse people — men, women, teens, elderly, all ethnicities — each experiencing a powerful personal moment of faith and realization. Quick cuts. Cinematic lighting. Emotional close-ups. Real moments. Golden-hour outdoor scenes mixed with interior candlelight. No text overlays. No logos. Authentic and raw.

End the video by naturally concluding on the provided branded final frame image. The branded image must remain clean, centered, readable, and recognizable. Do not distort, redesign, replace, or add extra text to the branded ending image.`;

// ─── Pacific time helper ──────────────────────────────────────────────────────

/**
 * Converts an HH:MM time string in America/Los_Angeles to a UTC ISO string
 * for "today" (as seen in Pacific time). Handles PST (UTC-8) and PDT (UTC-7).
 */
function pacificTimeToUTCISO(timeHHMM: string): string {
  const tz = "America/Los_Angeles";
  const todayPacific = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
  }).format(new Date()); // "YYYY-MM-DD"

  const [year, month, day] = todayPacific.split("-").map(Number);
  const [h, m] = timeHHMM.split(":").map(Number);

  // Try both PST (UTC-8) and PDT (UTC-7) offsets; keep the one that round-trips correctly
  for (const offsetHours of [8, 7]) {
    const candidate = new Date(
      Date.UTC(year, month - 1, day, h + offsetHours, m, 0)
    );
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(candidate);
    const ch = parseInt(parts.find((p) => p.type === "hour")?.value ?? "-1");
    const cm = parseInt(parts.find((p) => p.type === "minute")?.value ?? "-1");
    if (ch === h && cm === m) return candidate.toISOString();
  }
  // Fallback: assume PST
  return new Date(Date.UTC(year, month - 1, day, h + 8, m, 0)).toISOString();
}

// ─── Supabase helpers (inlined) ───────────────────────────────────────────────

function getSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key)
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set."
    );
  return createClient(url, key);
}

async function getPostingSettings(supabase: SupabaseClient) {
  const { data } = await supabase
    .from("gotjesus_posting_settings")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as {
    auto_post_enabled: boolean;
    instagram_enabled: boolean;
    tiktok_enabled: boolean;
    youtube_enabled: boolean;
    posts_per_day: number;
    posting_times: string[];
  } | null;
}

async function scheduledReelExists(
  supabase: SupabaseClient,
  scheduledForISO: string
): Promise<boolean> {
  const target = new Date(scheduledForISO);
  const from = new Date(target.getTime() - 5 * 60 * 1000).toISOString();
  const to = new Date(target.getTime() + 5 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("gotjesus_reels")
    .select("id")
    .eq("generation_source", "scheduled")
    .gte("scheduled_for", from)
    .lte("scheduled_for", to)
    .maybeSingle();
  return data !== null;
}

async function createReelRow(
  supabase: SupabaseClient,
  id: string,
  scheduledFor: string,
  platforms: string[]
): Promise<void> {
  await supabase.from("gotjesus_reels").insert({
    id,
    status: "generating",
    generation_source: "scheduled",
    scheduled_for: scheduledFor,
    caption_used: GOT_JESUS_CAPTION,
    instagram_enabled: platforms.includes("instagram"),
    tiktok_enabled: platforms.includes("tiktok"),
    youtube_enabled: platforms.includes("youtube"),
  });
}

async function updateReelRow(
  supabase: SupabaseClient,
  id: string,
  data: Record<string, unknown>
): Promise<void> {
  await supabase.from("gotjesus_reels").update(data).eq("id", id);
}

// ─── Kie.ai helpers (inlined) ─────────────────────────────────────────────────

async function submitKieJob(prompt: string): Promise<string> {
  const endCardUrl = process.env.GOT_JESUS_ENDCARD_SUPABASE_URL;
  const res = await fetch(`${KIE_BASE_URL}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KIE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "bytedance/seedance-2-fast",
      input: {
        prompt,
        aspect_ratio: "9:16",
        resolution: process.env.KIE_VIDEO_RESOLUTION || "480p",
        duration: 8,
        generate_audio: true,
        ...(endCardUrl ? { reference_image_urls: [endCardUrl] } : {}),
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kie createTask HTTP ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { data?: { taskId?: string } };
  const taskId = json.data?.taskId;
  if (!taskId) throw new Error("Kie: no taskId returned");
  return taskId;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollKieVideo(
  taskId: string,
  maxAttempts = 80
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    await delay(8000); // poll every 8 seconds
    const res = await fetch(
      `${KIE_BASE_URL}/api/v1/jobs/recordInfo?taskId=${taskId}`,
      {
        headers: { Authorization: `Bearer ${process.env.KIE_API_KEY}` },
        cache: "no-store",
      } as RequestInit
    );
    if (!res.ok) {
      console.warn(`[scheduler] Kie poll HTTP ${res.status}`);
      continue;
    }
    const json = (await res.json()) as {
      data?: { state?: string; failMsg?: string; resultJson?: string };
    };
    const task = json.data;
    if (!task) continue;
    if (task.state === "success" && task.resultJson) {
      const result = JSON.parse(task.resultJson) as { resultUrls?: string[] };
      const url = result.resultUrls?.[0];
      if (!url) throw new Error("Kie: success but no resultUrl");
      return url;
    }
    if (task.state === "fail") {
      throw new Error(`Kie generation failed: ${task.failMsg ?? "unknown"}`);
    }
    console.log(`[scheduler] Kie task ${taskId} state="${task.state}" (attempt ${i + 1})`);
  }
  throw new Error("Kie generation timed out after max poll attempts");
}

// ─── Storage helpers (inlined) ────────────────────────────────────────────────

async function downloadAndUpload(
  kieVideoUrl: string,
  reelId: string
): Promise<string> {
  const res = await fetch(kieVideoUrl);
  if (!res.ok)
    throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  console.log(
    `[scheduler] Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)} MB for reel ${reelId}`
  );

  const supabase = getSupabase();
  const filePath = `${FOLDER}/${reelId}.mp4`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, buffer, { contentType: "video/mp4", upsert: true });
  if (error)
    throw new Error(`Upload failed: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
  return data.publicUrl;
}

// ─── Blotato helpers (inlined) ────────────────────────────────────────────────

function blotatoHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${process.env.BLOTATO_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function blotatoUploadMedia(videoUrl: string): Promise<string> {
  const res = await fetch(`${BLOTATO_BASE_URL}/api/media/upload`, {
    method: "POST",
    headers: blotatoHeaders(),
    body: JSON.stringify({ url: videoUrl }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Blotato uploadMedia HTTP ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { mediaId?: string };
  if (!json.mediaId) throw new Error("Blotato uploadMedia: no mediaId");
  return json.mediaId;
}

type Platform = "instagram" | "tiktok" | "youtube";

function getAccountId(platform: Platform): string | undefined {
  if (platform === "instagram") return process.env.BLOTATO_INSTAGRAM_ACCOUNT_ID;
  if (platform === "tiktok") return process.env.BLOTATO_TIKTOK_ACCOUNT_ID;
  if (platform === "youtube") return process.env.BLOTATO_YOUTUBE_ACCOUNT_ID;
}

async function blotatoPublish(
  mediaId: string,
  platform: Platform,
  scheduledTime: string
): Promise<string> {
  const accountId = getAccountId(platform);
  if (!accountId) throw new Error(`No account ID for ${platform}`);
  const res = await fetch(`${BLOTATO_BASE_URL}/api/posts/publish`, {
    method: "POST",
    headers: blotatoHeaders(),
    body: JSON.stringify({
      mediaId,
      accountId,
      platform,
      caption: GOT_JESUS_CAPTION,
      scheduledTime,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Blotato publish [${platform}] HTTP ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { id?: string; postId?: string; submissionId?: string };
  return json.id ?? json.postId ?? json.submissionId ?? "unknown";
}

// ─── Handler ──────────────────────────────────────────────────────────────────

const handler: Handler = async () => {
  console.log("[scheduler] Daily scheduler starting");

  const supabase = getSupabase();

  // Read posting settings
  const settings = await getPostingSettings(supabase);
  if (!settings) {
    console.log("[scheduler] No posting settings found. Exiting.");
    return { statusCode: 200, body: "no settings" };
  }
  if (!settings.auto_post_enabled) {
    console.log("[scheduler] auto_post_enabled=false. Exiting.");
    return { statusCode: 200, body: "auto_post disabled" };
  }

  // Build platform list from enabled settings
  const enabledPlatforms: Platform[] = [];
  if (settings.instagram_enabled && process.env.BLOTATO_INSTAGRAM_ACCOUNT_ID)
    enabledPlatforms.push("instagram");
  if (settings.tiktok_enabled && process.env.BLOTATO_TIKTOK_ACCOUNT_ID)
    enabledPlatforms.push("tiktok");
  if (settings.youtube_enabled && process.env.BLOTATO_YOUTUBE_ACCOUNT_ID)
    enabledPlatforms.push("youtube");

  if (enabledPlatforms.length === 0) {
    console.log("[scheduler] No platforms enabled or configured. Exiting.");
    return { statusCode: 200, body: "no platforms" };
  }

  // Determine which posting times to process today
  const slots = (settings.posting_times ?? []).slice(0, settings.posts_per_day ?? 1);
  console.log(`[scheduler] Processing ${slots.length} slot(s): ${slots.join(", ")} (Pacific)`);

  for (const timeHHMM of slots) {
    const scheduledForISO = pacificTimeToUTCISO(timeHHMM);
    console.log(`[scheduler] Slot ${timeHHMM} Pacific → ${scheduledForISO} UTC`);

    // Duplicate check
    const exists = await scheduledReelExists(supabase, scheduledForISO);
    if (exists) {
      console.log(`[scheduler] Reel already exists for slot ${timeHHMM}. Skipping.`);
      continue;
    }

    // Create DB row
    const reelId = crypto.randomUUID();
    await createReelRow(supabase, reelId, scheduledForISO, enabledPlatforms);
    console.log(`[scheduler] Created reel ${reelId} for slot ${timeHHMM}`);

    try {
      // Generate Kie reel
      console.log(`[scheduler] Submitting Kie job for reel ${reelId}`);
      const taskId = await submitKieJob(CROSS_DISCOVERY_PROMPT);
      await updateReelRow(supabase, reelId, { kie_task_id: taskId });

      // Poll until done
      const kieVideoUrl = await pollKieVideo(taskId);
      await updateReelRow(supabase, reelId, { kie_video_url: kieVideoUrl, status: "saving" });
      console.log(`[scheduler] Kie video ready for reel ${reelId}`);

      // Download + save to Supabase
      const savedVideoUrl = await downloadAndUpload(kieVideoUrl, reelId);
      await updateReelRow(supabase, reelId, { saved_video_url: savedVideoUrl, status: "posting" });

      // Post to Blotato with scheduled time
      const mediaId = await blotatoUploadMedia(savedVideoUrl);
      const submissionIds: Record<string, string> = {};
      for (const platform of enabledPlatforms) {
        try {
          const id = await blotatoPublish(mediaId, platform, scheduledForISO);
          submissionIds[platform] = id;
          console.log(`[scheduler] Scheduled to ${platform}: ${id}`);
        } catch (err) {
          console.error(`[scheduler] Failed to schedule to ${platform}:`, err);
        }
      }

      await updateReelRow(supabase, reelId, {
        status: "scheduled",
        blotato_status: "submitted",
        instagram_post_submission_id: submissionIds.instagram ?? null,
        tiktok_post_submission_id: submissionIds.tiktok ?? null,
        youtube_post_submission_id: submissionIds.youtube ?? null,
      });
      console.log(`[scheduler] Reel ${reelId} scheduled for ${scheduledForISO}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[scheduler] Reel ${reelId} failed:`, message);
      await updateReelRow(supabase, reelId, {
        status: "failed",
        error_message: message,
      }).catch(() => {});
    }
  }

  console.log("[scheduler] Done");
  return { statusCode: 200 };
};

export { handler };
