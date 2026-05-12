/**
 * Blotato API client — server-side only. Never import this in client components.
 *
 * Required env vars:
 *   BLOTATO_API_KEY
 *   BLOTATO_INSTAGRAM_ACCOUNT_ID
 *   BLOTATO_YOUTUBE_ACCOUNT_ID
 *   BLOTATO_TIKTOK_ACCOUNT_ID
 *
 * Every post uses GOT_JESUS_DEFAULT_SOCIAL_CAPTION from src/lib/social-caption.ts.
 * Do not pass a different caption unless that constant has been explicitly changed.
 *
 * POSTING PATHS:
 *   MANUAL (Auto Post ON):
 *     After reel is saved → uploadMedia(savedVideoUrl) → publishToAll(mediaId, platforms)
 *     No scheduledTime — posts immediately.
 *
 *   SCHEDULED (daily-scheduler-background):
 *     Same uploadMedia → publishToAll() flow, but pass scheduledTime (ISO 8601 UTC).
 *     Convert Pacific posting_times to UTC via pacificTimeToUTCISO() in the scheduler.
 */

import { GOT_JESUS_DEFAULT_SOCIAL_CAPTION } from "@/lib/social-caption";

const BLOTATO_BASE_URL = "https://backend.blotato.com";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BlotatoPlatform = "instagram" | "youtube" | "tiktok";

export interface BlotatoUploadResponse {
  mediaId: string;
}

export interface BlotatoPublishRequest {
  mediaId: string;
  accountId: string;
  platform: BlotatoPlatform;
  caption: string;
  /** ISO 8601 UTC datetime. Omit for immediate posting. */
  scheduledTime?: string;
}

export interface BlotatoPublishResponse {
  /** The Blotato post / submission ID returned after scheduling. */
  id?: string;
  postId?: string;
  submissionId?: string;
}

// ─── Connection check ─────────────────────────────────────────────────────────

export function isBlotatoConnected(): boolean {
  return Boolean(
    process.env.BLOTATO_API_KEY &&
      (process.env.BLOTATO_INSTAGRAM_ACCOUNT_ID ||
        process.env.BLOTATO_YOUTUBE_ACCOUNT_ID ||
        process.env.BLOTATO_TIKTOK_ACCOUNT_ID)
  );
}

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
  if (!key)
    throw new Error(
      "BLOTATO_API_KEY is not set. Add it to your Netlify environment variables."
    );
  return key;
}

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    "Content-Type": "application/json",
  };
}

// ─── API calls ────────────────────────────────────────────────────────────────

/**
 * Upload a video by public URL to Blotato's media library.
 * Returns the Blotato mediaId used when publishing posts.
 * Pass the permanent Supabase Storage URL — not the temporary Kie URL.
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
 * Returns the Blotato submission ID for tracking post status.
 *
 * For immediate posting: omit scheduledTime.
 * For scheduled posting: pass scheduledTime as ISO 8601 UTC string.
 */
export async function publishPost(req: BlotatoPublishRequest): Promise<string> {
  const response = await fetch(`${BLOTATO_BASE_URL}/api/posts/publish`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      mediaId: req.mediaId,
      accountId: req.accountId,
      platform: req.platform,
      caption: req.caption,
      ...(req.scheduledTime ? { scheduledTime: req.scheduledTime } : {}),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Blotato publishPost [${req.platform}] HTTP ${response.status}: ${text}`
    );
  }

  const json = (await response.json()) as BlotatoPublishResponse;
  // Try common Blotato response field names for the submission ID
  return json.id ?? json.postId ?? json.submissionId ?? "unknown";
}

/**
 * Upload media and publish to all requested platforms in parallel.
 * Returns a map of platform → Blotato submission ID.
 *
 * Caption defaults to GOT_JESUS_DEFAULT_SOCIAL_CAPTION.
 * Pass scheduledTime (ISO 8601 UTC) for scheduled posts; omit for immediate.
 * Skips any platform whose account ID is not configured in env vars.
 * Skips any platform not in the provided platforms array.
 */
export async function publishToAll(
  videoUrl: string,
  platforms: BlotatoPlatform[],
  caption: string = GOT_JESUS_DEFAULT_SOCIAL_CAPTION,
  scheduledTime?: string
): Promise<Partial<Record<BlotatoPlatform, string>>> {
  const accountIds = getBlotatoAccountIds();
  const mediaId = await uploadMedia(videoUrl);

  const results: Partial<Record<BlotatoPlatform, string>> = {};

  const tasks = platforms
    .filter((p) => accountIds[p])
    .map(async (p) => {
      const submissionId = await publishPost({
        mediaId,
        accountId: accountIds[p]!,
        platform: p,
        caption,
        scheduledTime,
      });
      results[p] = submissionId;
    });

  await Promise.all(tasks);
  return results;
}
