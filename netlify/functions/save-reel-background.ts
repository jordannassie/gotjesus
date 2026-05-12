/**
 * Netlify Background Function — save-reel-background
 *
 * Invoked by POST /api/save-reel. Returns 202 immediately and runs
 * asynchronously for up to 15 minutes (Netlify background function limit).
 *
 * Flow:
 *   1. Download the finished Kie video from its temporary URL
 *   2. Upload it to Supabase Storage (bucket: SUPABASE_VIDEO_BUCKET / folder: SUPABASE_VIDEO_FOLDER)
 *   3. Update the gotjesus_reels DB row with saved_video_url and status="ready"
 *   4. If autoPost is true:
 *        a. Upload video URL to Blotato media library → get mediaId
 *        b. publishPost to each enabled platform → collect submission IDs
 *        c. Update DB row with Blotato IDs and status="posted"
 *
 * Supabase helpers and Blotato calls are inlined because Netlify background
 * functions are bundled separately and cannot resolve @/ path aliases.
 */

import type { Handler, HandlerEvent } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

// ─── Config ───────────────────────────────────────────────────────────────────

const BUCKET = process.env.SUPABASE_VIDEO_BUCKET || "GOT JESUS";
const FOLDER = process.env.SUPABASE_VIDEO_FOLDER || "gotjesus-videos";
const BLOTATO_BASE_URL = "https://backend.blotato.com";
const GOT_JESUS_CAPTION =
  "Jesus Loves You! \n#jesus #gotjesus gotjesus.co";

// ─── Supabase helpers (inlined) ───────────────────────────────────────────────

function getSupabase() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key)
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  return createClient(url, key);
}

async function updateReel(
  id: string,
  data: Record<string, unknown>
): Promise<void> {
  const { error } = await getSupabase()
    .from("gotjesus_reels")
    .update(data)
    .eq("id", id);
  if (error) {
    console.error(`[save-reel-bg] updateReel(${id}) error:`, error.message, JSON.stringify(error));
  }
}

// ─── Storage helpers (inlined) ────────────────────────────────────────────────

async function downloadAndUpload(
  kieVideoUrl: string,
  reelId: string
): Promise<string> {
  console.log(`[save-reel-bg] Downloading video for reel ${reelId}: ${kieVideoUrl}`);
  const res = await fetch(kieVideoUrl);
  if (!res.ok)
    throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  console.log(
    `[save-reel-bg] Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)} MB`
  );

  const supabase = getSupabase();
  const filePath = `${FOLDER}/${reelId}.mp4`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, buffer, { contentType: "video/mp4", upsert: true });

  if (error)
    throw new Error(
      `Supabase upload failed (bucket="${BUCKET}", path="${filePath}"): ${error.message}`
    );

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
  console.log(`[save-reel-bg] Uploaded → ${data.publicUrl}`);
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
  if (!json.mediaId) throw new Error("Blotato uploadMedia: no mediaId returned");
  return json.mediaId;
}

type BlotatoPlatform = "instagram" | "tiktok" | "youtube";

function getAccountId(platform: BlotatoPlatform): string | undefined {
  if (platform === "instagram") return process.env.BLOTATO_INSTAGRAM_ACCOUNT_ID;
  if (platform === "tiktok") return process.env.BLOTATO_TIKTOK_ACCOUNT_ID;
  if (platform === "youtube") return process.env.BLOTATO_YOUTUBE_ACCOUNT_ID;
}

async function blotatoPublishPost(
  mediaId: string,
  platform: BlotatoPlatform,
  scheduledTime?: string
): Promise<string> {
  const accountId = getAccountId(platform);
  if (!accountId) throw new Error(`No account ID configured for ${platform}`);

  const res = await fetch(`${BLOTATO_BASE_URL}/api/posts/publish`, {
    method: "POST",
    headers: blotatoHeaders(),
    body: JSON.stringify({
      mediaId,
      accountId,
      platform,
      caption: GOT_JESUS_CAPTION,
      ...(scheduledTime ? { scheduledTime } : {}),
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

const handler: Handler = async (event: HandlerEvent) => {
  let body: {
    reelId?: string;
    kieVideoUrl?: string;
    autoPost?: boolean;
    platforms?: string[];
    scheduledTime?: string;
  } = {};

  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: "Invalid JSON body" };
  }

  const { reelId, kieVideoUrl, autoPost = false, platforms = [], scheduledTime } = body;

  if (!reelId || !kieVideoUrl) {
    return { statusCode: 400, body: "Missing reelId or kieVideoUrl" };
  }

  console.log(`[save-reel-bg] Starting reel ${reelId} (autoPost=${autoPost})`);

  try {
    // ── Step 1: Download + upload to Supabase ─────────────────────────────────
    const savedVideoUrl = await downloadAndUpload(kieVideoUrl, reelId);
    await updateReel(reelId, { saved_video_url: savedVideoUrl, status: "ready" });

    // ── Step 2: Blotato posting (if autoPost) ─────────────────────────────────
    if (autoPost && platforms.length > 0 && process.env.BLOTATO_API_KEY) {
      await updateReel(reelId, { status: "posting" });
      console.log(`[save-reel-bg] Posting reel ${reelId} to ${platforms.join(", ")}`);

      const mediaId = await blotatoUploadMedia(savedVideoUrl);
      const submissionIds: Record<string, string> = {};

      for (const platform of platforms as BlotatoPlatform[]) {
        try {
          const id = await blotatoPublishPost(mediaId, platform, scheduledTime);
          submissionIds[platform] = id;
          console.log(`[save-reel-bg] Posted to ${platform}: ${id}`);
        } catch (err) {
          console.error(`[save-reel-bg] Failed to post to ${platform}:`, err);
        }
      }

      const isScheduled = Boolean(scheduledTime);
      await updateReel(reelId, {
        status: isScheduled ? "scheduled" : "posted",
        blotato_status: "submitted",
        instagram_post_submission_id: submissionIds.instagram ?? null,
        tiktok_post_submission_id: submissionIds.tiktok ?? null,
        youtube_post_submission_id: submissionIds.youtube ?? null,
      });
      console.log(`[save-reel-bg] Reel ${reelId} ${isScheduled ? "scheduled" : "posted"}`);
    } else {
      console.log(`[save-reel-bg] Reel ${reelId} saved (no auto-post)`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[save-reel-bg] Reel ${reelId} FAILED:`, message);
    await updateReel(reelId, { status: "failed", error_message: message }).catch(() => {});
  }

  return { statusCode: 200 };
};

export { handler };
