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

// ─── Blotato helpers (inlined — v2 API) ──────────────────────────────────────
//
// Auth: blotato-api-key header (NOT Authorization: Bearer)
// Publish: POST /v2/posts — pass video URL directly in mediaUrls, no separate upload
// Status: GET /v2/posts/{postSubmissionId}

function blotatoApiHeaders(): HeadersInit {
  return {
    "blotato-api-key": process.env.BLOTATO_API_KEY!,
    "Content-Type": "application/json",
  };
}

type BlotatoPlatform = "instagram" | "tiktok" | "youtube";

function getAccountId(platform: BlotatoPlatform): string | undefined {
  if (platform === "instagram") return process.env.BLOTATO_INSTAGRAM_ACCOUNT_ID;
  if (platform === "tiktok") return process.env.BLOTATO_TIKTOK_ACCOUNT_ID;
  if (platform === "youtube") return process.env.BLOTATO_YOUTUBE_ACCOUNT_ID;
}

function buildBlotatoTarget(platform: BlotatoPlatform): Record<string, unknown> {
  if (platform === "instagram") {
    return { targetType: "instagram", mediaType: "reel" };
  }
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
  // youtube
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
  platform: BlotatoPlatform,
  scheduledTime?: string
): Promise<string> {
  const accountId = getAccountId(platform);
  if (!accountId) throw new Error(`No Blotato account ID configured for ${platform}`);

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
    // scheduledTime is a TOP-LEVEL sibling of `post` per Blotato v2 spec
    ...(scheduledTime ? { scheduledTime } : {}),
  };

  console.log(`[manual-post] Calling Blotato POST /v2/posts for ${platform}`);

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
  const id = json.postSubmissionId ?? "unknown";
  console.log(`[manual-post] Blotato accepted ${platform} → postSubmissionId=${id}`);
  return id;
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

    // ── Step 2: Blotato posting (if autoPost / manual_post_enabled) ──────────
    if (!autoPost) {
      console.log(`[manual-post] Manual posting disabled — skipping Blotato`);
    } else if (platforms.length === 0) {
      console.log(`[manual-post] No platforms selected — skipping Blotato`);
    } else if (!process.env.BLOTATO_API_KEY) {
      console.log(`[manual-post] BLOTATO_API_KEY not set — skipping Blotato`);
    } else {
      console.log(`[manual-post] Manual posting enabled`);
      console.log(`[manual-post] Selected platforms: ${platforms.join(", ")}`);
      console.log(`[manual-post] Saved video URL: ${savedVideoUrl}`);
      console.log(`[manual-post] Calling Blotato...`);

      await updateReel(reelId, { status: "posting" });

      const submissionIds: Record<string, string> = {};
      const platformStatuses: Record<string, string> = {};
      const platformErrors: Record<string, string> = {};

      for (const platform of platforms as BlotatoPlatform[]) {
        try {
          const id = await blotatoPublish(savedVideoUrl, platform, scheduledTime);
          submissionIds[platform] = id;
          platformStatuses[platform] = "submitted";
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          platformErrors[platform] = msg;
          platformStatuses[platform] = "failed";
          console.error(`[manual-post] Failed to post to ${platform}:`, msg);
        }
      }

      console.log(`[manual-post] Blotato submission IDs:`, JSON.stringify(submissionIds));
      if (Object.keys(platformErrors).length > 0) {
        console.error(`[manual-post] Blotato errors:`, JSON.stringify(platformErrors));
      }

      const isScheduled = Boolean(scheduledTime);
      const anySucceeded = Object.keys(submissionIds).length > 0;

      await updateReel(reelId, {
        status: isScheduled ? "scheduled" : anySucceeded ? "posted" : "ready",
        blotato_status: anySucceeded ? "submitted" : "failed",
        instagram_post_submission_id: submissionIds.instagram ?? null,
        tiktok_post_submission_id: submissionIds.tiktok ?? null,
        youtube_post_submission_id: submissionIds.youtube ?? null,
        instagram_post_status: platformStatuses.instagram ?? null,
        tiktok_post_status: platformStatuses.tiktok ?? null,
        youtube_post_status: platformStatuses.youtube ?? null,
        instagram_error: platformErrors.instagram ?? null,
        tiktok_error: platformErrors.tiktok ?? null,
        youtube_error: platformErrors.youtube ?? null,
      });
      console.log(`[manual-post] Reel ${reelId} ${isScheduled ? "scheduled" : anySucceeded ? "posted" : "posting failed"}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[save-reel-bg] Reel ${reelId} FAILED:`, message);
    await updateReel(reelId, { status: "failed", error_message: message }).catch(() => {});
  }

  return { statusCode: 200 };
};

export { handler };
