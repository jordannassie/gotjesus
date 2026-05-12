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

/**
 * Upload a video by URL to Blotato's media library.
 * Returns the Blotato mediaId to use when publishing posts.
 *
 * TODO (Step 4): Implement once Blotato upload endpoint is confirmed.
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
 * TODO (Step 4): Implement once Blotato publish endpoint is confirmed.
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
 * TODO (Step 4): Call this from the generate-video route after end card assembly.
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
