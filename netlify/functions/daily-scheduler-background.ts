/**
 * Netlify Scheduled Background Function — daily-scheduler-background
 *
 * Runs every day at 13:00 UTC (= 5 AM PST / 6 AM PDT).
 *
 * Scheduling is fully slot-based. gotjesus_content_slots is the ONLY source of
 * truth for prompts, scheduled times, reference images, and generation settings.
 * There is NO legacy posting_times / posts_per_day fallback — that path has
 * been removed. If there are no enabled slots, the scheduler exits cleanly.
 *
 * For each enabled content slot whose scheduled_post_time matches today:
 *   1. Check for duplicate — skip if a scheduled reel already exists within ±5 min.
 *   2. Create a gotjesus_reels row (status="generating", source="scheduled").
 *   3. Submit a Kie.ai Seedance 2.0 job using the slot's prompt + reference images.
 *   4. Poll Kie until the video is ready (up to ~10 minutes).
 *   5. Download + upload video to Supabase Storage.
 *   6. Publish to Blotato with scheduledTime = the slot's Pacific time in UTC.
 *   7. Update the DB row with Blotato submission IDs and status="scheduled".
 *
 * gotjesus_posting_settings.auto_post_enabled acts as a global master ON/OFF gate.
 * Platform toggles (instagram_enabled, tiktok_enabled, youtube_enabled) in that
 * table control which platforms receive posts.
 *
 * All helpers are inlined because Netlify background functions are bundled
 * separately and cannot resolve @/ path aliases.
 *
 * Max runtime: 15 minutes (Netlify background function limit).
 */

import type { Handler } from "@netlify/functions";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ─── Config (inlined) ─────────────────────────────────────────────────────────

const KIE_BASE_URL = "https://api.kie.ai";
const BLOTATO_BASE_URL = "https://backend.blotato.com";
const BUCKET = process.env.SUPABASE_VIDEO_BUCKET || "GOT JESUS";
const FOLDER = process.env.SUPABASE_VIDEO_FOLDER || "gotjesus-videos";
const GOT_JESUS_CAPTION = "Jesus Loves You! \n#jesus #gotjesus gotjesus.co";

// ─── Prompt (MUST stay word-for-word identical to src/lib/cross-prompt.ts) ───
//
// Netlify background functions cannot import @/ path aliases, so the prompt is
// inlined here. PROMPT_VERSION is the shared version tag — bump it in both files
// whenever you update the prompt text.
//
// Source of truth: src/lib/cross-prompt.ts
// Version: gotjesus-cross-v3-no-clergy-people-first

const PROMPT_VERSION = "gotjesus-cross-v3-no-clergy-people-first";

const CROSS_DISCOVERY_PROMPT = `Create an 8-second vertical 9:16 viral social media video.

Structure:
- First 7 seconds: 7 completely separate cinematic clips, about 1 second each
- Final 1 second: a hard cut to the exact provided Got Jesus logo end card on a clean black screen

Very important structure rule:
Each of the first 7 clips must be one single continuous cinematic shot, not a montage. Do not create multiple micro-shots, multiple cutaways, or a sequence of different images inside one 1-second clip. Each clip must feel like one complete movie moment captured in one camera shot.

Main concept for the first 7 seconds:
Each clip must show a different abstract everyday-life scene with a clearly visible person or people as the primary subject of the shot. Every clip must contain a clearly visible cross shape that specifically resembles a classic upright Christian / Latin cross silhouette, but only as an abstract form naturally found within the environment.

Critical people rule:
A person or people must appear clearly in every single clip and must be a major visible part of the frame. Do not generate empty scenery, empty buildings, empty streets, empty nature shots, or environment-only shots. Do not place people only as tiny distant background figures. The human subject must feel central to the shot.

The cross shape must feel hidden in plain sight through things like:
- shadows
- reflections
- architecture
- light
- framing
- object placement
- negative space
- composition
- textures
- structures in the environment

Important:
The cross must look like a Christian / Latin cross shape, but it must not appear as a religious object. It should feel discovered, not intentionally displayed.

Absolute religion exclusion rules:
- No priests
- No pastors
- No clergy
- No monks
- No nuns
- No bishops
- No rabbis
- No religious leaders
- No robes
- No clerical collars
- No vestments
- No ceremonial clothing
- No church interiors
- No church exteriors
- No chapels
- No cathedrals
- No altars
- No candles arranged for worship
- No religious ceremonies
- No rituals
- No spiritual gatherings
- No prayer
- No worship
- No Bibles
- No crucifixes
- No sermons
- No stained glass
- No religious clothing
- No spiritual rituals
- No overt Christian imagery beyond the abstract cross shape hidden in the environment

Strong instruction:
Do not show any person, clothing, location, object, or atmosphere that suggests organized religion, clergy, worship, ritual, church culture, religious leadership, sacred ceremony, or ceremonial spirituality. The only Christian-like element allowed is the abstract upright cross shape hidden naturally in ordinary life.

Additional hard rules for the first 7 seconds:
- Every clip must include a clearly visible person or people
- People must be central, obvious, and readable in the frame
- No empty building shots
- No empty tree shots
- No empty landscape shots
- No environment-only shots
- No talking
- No voiceover
- No subtitles
- No captions
- No social media UI
- No watermarks
- No logos during the montage
- No continuous background music
- Hard cuts only between clips
- No morphing
- No dissolves
- No blended transitions
- No mini-montage inside any individual clip
- No multiple scene changes within a clip
- No multiple camera angles within a clip

People direction:
Every clip must include a person or people naturally doing something in the scene. They should feel real, candid, and cinematic, not posed. Vary the people, actions, energy, wardrobe, age, and mood across the clips. The human presence should drive the shot.

Visual direction:
Make every clip feel distinct, cinematic, and visually fresh. Use different environments, moods, lighting, framing, and camera language so the clips do not feel repetitive. But each clip must remain a single shot that feels like one full movie moment with a human subject clearly visible.

Style:
Cinematic, realistic, artistic, premium viral aesthetic, subtle film grain, natural imperfections, strong composition, emotionally compelling, visually striking.

Shot behavior:
Each clip should feel like a real movie shot: one scene, one camera perspective, one visual idea, one action beat, one emotional moment. Keep it simple, clear, and strong. The viewer should instantly understand the full moment. The person should be visually important in the shot.

Audio:
Each montage clip should contain only its own natural ambient scene audio. No narration. No speech. No full-song music track across the whole video.

Final 1-second ending:
After the 7 cinematic clips, hard cut to a clean black end card using the exact provided Got Jesus logo image centered on screen. The logo must stay visually faithful to the reference image, sharp, clean, readable, undistorted, and unchanged. Do not redesign it. Do not add extra text. Hold this exact branded end card for the final 1 second.

The reference image provided is the exact Got Jesus logo end card. Use it precisely and faithfully for the final 1-second branded end card described above: centered white logo on clean black, sharp and undistorted.`;

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
    .select("auto_post_enabled, instagram_enabled, tiktok_enabled, youtube_enabled")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as {
    auto_post_enabled: boolean;
    instagram_enabled: boolean;
    tiktok_enabled: boolean;
    youtube_enabled: boolean;
  } | null;
}

interface ContentSlotRow {
  id: string;
  slot_key: string;
  slot_name: string;
  prompt_text: string;
  reference_images: Array<{ url: string; path: string; name: string }>;
  enabled: boolean;
  scheduled_post_time: string;
  resolution: string;
  duration_seconds: number;
  aspect_ratio: string;
  sort_order: number;
}

async function getEnabledContentSlots(supabase: SupabaseClient): Promise<ContentSlotRow[]> {
  const { data, error } = await supabase
    .from("gotjesus_content_slots")
    .select("id, slot_key, slot_name, prompt_text, reference_images, enabled, scheduled_post_time, resolution, duration_seconds, aspect_ratio, sort_order")
    .eq("workspace_key", "gotjesus")
    .eq("enabled", true)
    .order("sort_order", { ascending: true });

  if (error) {
    console.warn("[scheduler] getEnabledContentSlots error:", error.message);
    return [];
  }
  return (data ?? []) as ContentSlotRow[];
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

/**
 * Reads the active official end card URL from gotjesus_brand_settings (DB first,
 * then GOT_JESUS_ENDCARD_SUPABASE_URL env var as fallback).
 * Inlined because the scheduler cannot import @/ path aliases.
 */
async function getEndCardUrl(supabase: SupabaseClient): Promise<string | undefined> {
  try {
    const { data } = await supabase
      .from("gotjesus_brand_settings")
      .select("end_card_image_url")
      .eq("workspace_key", "gotjesus")
      .maybeSingle();
    const fromDb = (data as { end_card_image_url?: string | null } | null)?.end_card_image_url;
    if (fromDb) return fromDb;
  } catch { /* fall through */ }
  return process.env.GOT_JESUS_ENDCARD_SUPABASE_URL;
}

// Output aspect ratio is LOCKED to "9:16" for all Got Jesus reels.
const LOCKED_ASPECT_RATIO = "9:16";

async function submitKieJob(
  supabase: SupabaseClient,
  prompt: string,
  slotImageUrls: string[] = [],
  resolution?: string,
  durationSeconds?: number
): Promise<string> {
  // Read the active end card from DB (falls back to env var)
  const endCardUrl = await getEndCardUrl(supabase);
  // Slot images first, end card always last so Seedance anchors the branded ending
  const allRefs = [...slotImageUrls, ...(endCardUrl ? [endCardUrl] : [])];
  const res = resolution ?? process.env.KIE_VIDEO_RESOLUTION ?? "480p";
  const dur = durationSeconds ?? 8;

  console.log(`[kie] locked aspect_ratio payload = "${LOCKED_ASPECT_RATIO}"`);
  console.log(
    `[kie] full compact input summary = model=bytedance/seedance-2-fast ` +
    `duration=${dur} resolution=${res} aspect_ratio=${LOCKED_ASPECT_RATIO} ` +
    `reference_image_count=${allRefs.length}`
  );

  const fetchRes = await fetch(`${KIE_BASE_URL}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KIE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "bytedance/seedance-2-fast",
      input: {
        prompt,
        aspect_ratio: LOCKED_ASPECT_RATIO, // must be "9:16" string — Kie rejects numeric floats
        resolution: res,
        duration: dur,
        generate_audio: true,
        ...(allRefs.length > 0 ? { reference_image_urls: allRefs } : {}),
      },
    }),
  });
  if (!fetchRes.ok) {
    const text = await fetchRes.text();
    throw new Error(`Kie createTask HTTP ${fetchRes.status}: ${text}`);
  }
  const json = (await fetchRes.json()) as { data?: { taskId?: string } };
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

// ─── Blotato helpers (inlined — v2 API) ──────────────────────────────────────
//
// Auth: blotato-api-key header (NOT Authorization: Bearer)
// Publish: POST /v2/posts — pass video URL directly in mediaUrls, no upload step
// scheduledTime must be top-level (sibling of `post`), NOT nested inside `post`

function blotatoApiHeaders(): HeadersInit {
  return {
    "blotato-api-key": process.env.BLOTATO_API_KEY!,
    "Content-Type": "application/json",
  };
}

type Platform = "instagram" | "tiktok" | "youtube";

function getAccountId(platform: Platform): string | undefined {
  if (platform === "instagram") return process.env.BLOTATO_INSTAGRAM_ACCOUNT_ID;
  if (platform === "tiktok") return process.env.BLOTATO_TIKTOK_ACCOUNT_ID;
  if (platform === "youtube") return process.env.BLOTATO_YOUTUBE_ACCOUNT_ID;
}

function buildBlotatoTarget(platform: Platform): Record<string, unknown> {
  if (platform === "instagram") return { targetType: "instagram", mediaType: "reel" };
  if (platform === "tiktok") {
    return {
      targetType: "tiktok",
      privacyLevel: "PUBLIC_TO_EVERYONE",
      disabledComments: false,
      disabledDuet: false,
      disabledStitch: false,
      isBrandedContent: false,
      isYourBrand: false,
      isAiGenerated: true,
    };
  }
  return {
    targetType: "youtube",
    title: "Jesus Loves You! | Got Jesus",
    privacyStatus: "public",
    shouldNotifySubscribers: true,
    containsSyntheticMedia: true,
  };
}

async function blotatoPublish(
  videoUrl: string,
  platform: Platform,
  scheduledTime: string
): Promise<string> {
  const accountId = getAccountId(platform);
  if (!accountId) throw new Error(`No Blotato account ID for ${platform}`);

  const body: Record<string, unknown> = {
    post: {
      accountId,
      content: {
        text: GOT_JESUS_CAPTION,
        mediaUrls: [videoUrl],
        platform,
      },
      target: buildBlotatoTarget(platform),
    },
    scheduledTime, // top-level, NOT nested inside post
  };

  const res = await fetch(`${BLOTATO_BASE_URL}/v2/posts`, {
    method: "POST",
    headers: blotatoApiHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Blotato POST /v2/posts [${platform}] HTTP ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { postSubmissionId?: string };
  return json.postSubmissionId ?? "unknown";
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

  // Load enabled content slots — the ONLY source of schedule/prompt/image data.
  // No legacy posting_times / posts_per_day fallback exists.
  const contentSlots = await getEnabledContentSlots(supabase);
  console.log(`[scheduler] Found ${contentSlots.length} enabled content slot(s)`);

  if (contentSlots.length === 0) {
    console.log("[scheduler] No enabled content slots. Exiting.");
    return { statusCode: 200, body: "no enabled content slots" };
  }

  const slotsToProcess = contentSlots.map((s) => ({
    timeHHMM: s.scheduled_post_time,
    promptText: s.prompt_text || CROSS_DISCOVERY_PROMPT,
    imageUrls: (s.reference_images ?? []).map((img) => img.url),
    resolution: s.resolution || "480p",
    durationSeconds: s.duration_seconds || 8,
    slotKey: s.slot_key,
  }));

  console.log(
    `[scheduler] Processing ${slotsToProcess.length} slot(s): ${slotsToProcess.map((s) => `${s.slotKey}@${s.timeHHMM}`).join(", ")}`
  );

  const NATIVE_ENDING_SUFFIX =
    "\n\nThe reference image provided is the exact Got Jesus logo end card. Use it precisely and faithfully for the final 1-second branded end card described above: centered white logo on clean black, sharp and undistorted.";

  for (const slotInfo of slotsToProcess) {
    const { timeHHMM, promptText, imageUrls, resolution, durationSeconds, slotKey } = slotInfo;
    const scheduledForISO = pacificTimeToUTCISO(timeHHMM);
    console.log(`[scheduler] Slot ${slotKey} ${timeHHMM} Pacific → ${scheduledForISO} UTC`);

    // Duplicate check
    const exists = await scheduledReelExists(supabase, scheduledForISO);
    if (exists) {
      console.log(`[scheduler] Reel already exists for slot ${slotKey} ${timeHHMM}. Skipping.`);
      continue;
    }

    // Create DB row
    const reelId = crypto.randomUUID();
    await createReelRow(supabase, reelId, scheduledForISO, enabledPlatforms);
    console.log(`[scheduler] Created reel ${reelId} for slot ${slotKey}`);

    try {
      // Generate Kie reel using slot's prompt + images
      console.log(`[prompt] version=${PROMPT_VERSION} source=scheduled slot=${slotKey}`);
      console.log(`[scheduler] Submitting Kie job for reel ${reelId}`);
      const fullPrompt = promptText + NATIVE_ENDING_SUFFIX;
      const taskId = await submitKieJob(supabase, fullPrompt, imageUrls, resolution, durationSeconds);
      await updateReelRow(supabase, reelId, {
        kie_task_id: taskId,
        prompt_used: `[${slotKey}] ${promptText.slice(0, 200)}`,
      });

      // Poll until done
      const kieVideoUrl = await pollKieVideo(taskId);
      await updateReelRow(supabase, reelId, { kie_video_url: kieVideoUrl, status: "saving" });
      console.log(`[scheduler] Kie video ready for reel ${reelId}`);

      // Download + save to Supabase
      const savedVideoUrl = await downloadAndUpload(kieVideoUrl, reelId);
      await updateReelRow(supabase, reelId, { saved_video_url: savedVideoUrl, status: "posting" });

      // Post to Blotato with scheduled time
      const submissionIds: Record<string, string> = {};
      for (const platform of enabledPlatforms) {
        try {
          const id = await blotatoPublish(savedVideoUrl, platform, scheduledForISO);
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
