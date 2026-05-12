/**
 * Blotato API client — server-side only. Never import this in client components.
 *
 * Required env vars:
 *   BLOTATO_API_KEY
 *   BLOTATO_INSTAGRAM_ACCOUNT_ID
 *   BLOTATO_YOUTUBE_ACCOUNT_ID
 *   BLOTATO_TIKTOK_ACCOUNT_ID
 *
 * TODO (Step 4): Wire uploadMedia and publishPost into the post-generation pipeline.
 */

const BLOTATO_BASE_URL = "https://backend.blotato.com";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BlotatoPlatform = "instagram" | "youtube" | "tiktok";

export interface BlotatoPostTarget {
  platform: BlotatoPlatform;
  accountId: string;
}

export interface BlotatoUploadResponse {
  mediaId: string;
}

export interface BlotatoPublishRequest {
  mediaId: string;
  accountId: string;
  platform: BlotatoPlatform;
  caption: string;
}

// ─── Connection check ─────────────────────────────────────────────────────────

/**
 * Returns true if all required Blotato env vars are present.
 * Safe to call from server components or API routes.
 */
export function isBlotatoConnected(): boolean {
  return Boolean(
    process.env.BLOTATO_API_KEY &&
      (process.env.BLOTATO_INSTAGRAM_ACCOUNT_ID ||
        process.env.BLOTATO_YOUTUBE_ACCOUNT_ID ||
        process.env.BLOTATO_TIKTOK_ACCOUNT_ID)
  );
}

/**
 * Returns the configured account IDs, keyed by platform.
 * Only includes platforms that have an account ID set.
 */
export function getBlotatoAccountIds(): Partial<Record<BlotatoPlatform, string>> {
  const ids: Partial<Record<BlotatoPlatform, string>> = {};
  if (process.env.BLOTATO_INSTAGRAM_ACCOUNT_ID)
    ids.instagram = process.env.BLOTATO_INSTAGRAM_ACCOUNT_ID;
  if (process.env.BLOTATO_YOUTUBE_ACCOUNT_ID)
    ids.youtube = process.env.BLOTATO_YOUTUBE_ACCOUNT_ID;
  if (process.env.BLOTATO_TIKTOK_ACCOUNT_ID)
    ids.tiktok = process.env.BLOTATO_TIKTOK_ACCOUNT_ID;
  return ids;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.BLOTATO_API_KEY;
  if (!key) {
    throw new Error(
      "BLOTATO_API_KEY is not set. Add it to .env.local or your Netlify environment variables."
    );
  }
  return key;
}

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    "Content-Type": "application/json",
  };
}

// ─── API calls ────────────────────────────────────────────────────────────────
//
// POSTING PATHS — two distinct flows share this API client:
//
//   MANUAL POST (Step 6):
//     User clicks "Post Now" after a final reel is ready.
//     Flow: uploadMedia(finalVideoUrl) → publishToAll(mediaId, platforms, caption)
//     No scheduledTime — post immediately.
//
//   SCHEDULED AUTOMATIC POST (Step 7):
//     Triggered by a cron job or Netlify scheduled function.
//     Reads posting_times from gotjesus_posting_settings (Pacific Time).
//     Converts each HH:MM time to a UTC ISO timestamp via Intl.DateTimeFormat.
//     Flow: uploadMedia(finalVideoUrl) → publishToAll(mediaId, platforms, caption, scheduledTime)
//     Blotato's scheduledTime field accepts an ISO 8601 UTC datetime string.
//
//   PLATFORM HANDLING:
//     publishToAll() already filters platforms by what is enabled in env vars.
//     When the full pipeline is live, also filter by the user's platform toggles
//     from posting settings (instagramEnabled, tiktokEnabled, youtubeEnabled).

/**
 * Upload a video by URL to Blotato's media library.
 * Returns the Blotato mediaId to use when publishing posts.
 *
 * TODO (Step 6): Confirm exact Blotato upload endpoint path and request shape.
 *   Manual post path: call this immediately after final reel is ready.
 *   Scheduled post path: call this from the scheduled automation function.
 */
export async function uploadMedia(videoUrl: string): Promise<string> {
  const response = await fetch(`${BLOTATO_BASE_URL}/api/media/upload`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ url: videoUrl }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Blotato uploadMedia HTTP ${response.status}: ${text}`);
  }

  const json = (await response.json()) as BlotatoUploadResponse;
  return json.mediaId;
}

/**
 * Publish a video to a single platform via Blotato.
 *
 * TODO (Step 6): Confirm Blotato publish endpoint path and full request shape.
 *   Add optional `scheduledTime?: string` (ISO 8601 UTC) to BlotatoPublishRequest
 *   when wiring up the scheduled automatic posting flow (Step 7).
 *   For the manual post path, omit scheduledTime — post immediately.
 */
export async function publishPost(req: BlotatoPublishRequest): Promise<void> {
  const response = await fetch(`${BLOTATO_BASE_URL}/api/posts/publish`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      mediaId: req.mediaId,
      accountId: req.accountId,
      platform: req.platform,
      caption: req.caption,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Blotato publishPost [${req.platform}] HTTP ${response.status}: ${text}`
    );
  }
}

/**
 * Publish a completed video to all requested platforms in parallel.
 * Skips any platform whose accountId is missing in the env.
 *
 * TODO (Step 6): Wire into the finalization pipeline after end card assembly.
 *   Also cross-check against the user's platform toggles from posting settings
 *   (instagramEnabled, tiktokEnabled, youtubeEnabled) before posting.
 *
 * TODO (Step 7): Add optional `scheduledTime?: string` parameter.
 *   Convert posting_times (HH:MM Pacific) to ISO 8601 UTC and pass to publishPost().
 *   Use: new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', ... })
 *   to handle Pacific daylight-saving time correctly.
 */
export async function publishToAll(
  mediaId: string,
  platforms: BlotatoPlatform[],
  caption: string
): Promise<void> {
  const accountIds = getBlotatoAccountIds();

  const tasks = platforms
    .filter((p) => accountIds[p])
    .map((p) =>
      publishPost({
        mediaId,
        accountId: accountIds[p]!,
        platform: p,
        caption,
      })
    );

  await Promise.all(tasks);
}
