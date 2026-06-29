/**
 * Blotato API v2 client — server-side only.
 *
 * API base: https://backend.blotato.com/v2
 * Auth header: blotato-api-key (NOT Authorization: Bearer)
 * Publish endpoint: POST /v2/posts  (no separate media upload needed — pass URL directly)
 * Status endpoint: GET  /v2/posts/{postSubmissionId}
 *
 * Required env vars:
 *   BLOTATO_API_KEY
 *   BLOTATO_INSTAGRAM_ACCOUNT_ID
 *   BLOTATO_YOUTUBE_ACCOUNT_ID
 *   BLOTATO_TIKTOK_ACCOUNT_ID
 *   BLOTATO_FACEBOOK_ACCOUNT_ID   (Facebook connected account from Blotato)
 *   BLOTATO_FACEBOOK_PAGE_ID      (Facebook Page subaccount ID from Blotato)
 */

import { GOT_JESUS_DEFAULT_SOCIAL_CAPTION } from "@/lib/social-caption";

const BLOTATO_BASE_URL = "https://backend.blotato.com";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BlotatoPlatform = "instagram" | "facebook" | "tiktok" | "youtube";

export type BlotatoPostStatus = "in-progress" | "scheduled" | "published" | "failed";

export interface BlotatoPostStatusResponse {
  status: BlotatoPostStatus;
  publicUrl?: string;
  errorMessage?: string;
}

export interface BlotatoPublishResult {
  platform: BlotatoPlatform;
  postSubmissionId: string;
}

// ─── Connection check ─────────────────────────────────────────────────────────

export function isBlotatoConnected(): boolean {
  return Boolean(
    process.env.BLOTATO_API_KEY &&
      (process.env.BLOTATO_INSTAGRAM_ACCOUNT_ID ||
        process.env.BLOTATO_YOUTUBE_ACCOUNT_ID ||
        process.env.BLOTATO_TIKTOK_ACCOUNT_ID ||
        process.env.BLOTATO_FACEBOOK_ACCOUNT_ID)
  );
}

/**
 * Returns true when Facebook is fully configured — both account ID and page ID
 * must be present because Blotato requires both for Facebook posts.
 */
export function isFacebookConfigured(): boolean {
  return Boolean(
    process.env.BLOTATO_FACEBOOK_ACCOUNT_ID &&
    process.env.BLOTATO_FACEBOOK_PAGE_ID
  );
}

export function getBlotatoAccountIds(): Partial<Record<BlotatoPlatform, string>> {
  const ids: Partial<Record<BlotatoPlatform, string>> = {};
  if (process.env.BLOTATO_INSTAGRAM_ACCOUNT_ID)
    ids.instagram = process.env.BLOTATO_INSTAGRAM_ACCOUNT_ID;
  if (process.env.BLOTATO_FACEBOOK_ACCOUNT_ID)
    ids.facebook = process.env.BLOTATO_FACEBOOK_ACCOUNT_ID;
  if (process.env.BLOTATO_TIKTOK_ACCOUNT_ID)
    ids.tiktok = process.env.BLOTATO_TIKTOK_ACCOUNT_ID;
  if (process.env.BLOTATO_YOUTUBE_ACCOUNT_ID)
    ids.youtube = process.env.BLOTATO_YOUTUBE_ACCOUNT_ID;
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
    "blotato-api-key": getApiKey(),
    "Content-Type": "application/json",
  };
}

/**
 * Build the platform-specific `target` object for the Blotato v2 posts API.
 * Each platform has its own required fields.
 *
 * Facebook requires BOTH accountId (connected account) AND pageId (Page subaccount).
 * accountId goes in the post body; pageId goes inside the target object.
 */
function buildTarget(platform: BlotatoPlatform): Record<string, unknown> {
  if (platform === "instagram") {
    return {
      targetType: "instagram",
      mediaType: "reel",
    };
  }
  if (platform === "facebook") {
    const pageId = process.env.BLOTATO_FACEBOOK_PAGE_ID;
    if (!pageId) {
      throw new Error(
        "Missing BLOTATO_FACEBOOK_PAGE_ID. Facebook posting requires a Page ID from Blotato subaccounts."
      );
    }
    return {
      targetType: "facebook",
      pageId,
      mediaType: "reel",
    };
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
  if (platform === "youtube") {
    return {
      targetType: "youtube",
      title: "Jesus Loves You! | Got Jesus",
      privacyStatus: "public",
      shouldNotifySubscribers: true,
      containsSyntheticMedia: true,
    };
  }
  throw new Error(`Unknown Blotato platform: ${platform}`);
}

// ─── API calls ────────────────────────────────────────────────────────────────

/**
 * Publish a video to a single platform via Blotato v2.
 *
 * Passes the Supabase permanent video URL directly in mediaUrls — no
 * separate media upload step is required.
 *
 * Returns the postSubmissionId for status polling.
 *
 * For immediate posting: omit scheduledTime.
 * For scheduled posting: pass scheduledTime as ISO 8601 UTC string
 *   (must be a sibling of `post`, not nested inside it).
 */
export async function publishPost(
  videoUrl: string,
  platform: BlotatoPlatform,
  accountId: string,
  caption: string,
  scheduledTime?: string
): Promise<string> {
  const body: Record<string, unknown> = {
    post: {
      accountId,
      content: {
        text: caption,
        mediaUrls: [videoUrl],
        platform,
      },
      target: buildTarget(platform),
    },
    // scheduledTime must be a top-level sibling of `post`, not nested
    ...(scheduledTime ? { scheduledTime } : {}),
  };

  console.log(`[blotato] POST /v2/posts platform=${platform} accountId=${accountId}${platform === "facebook" ? ` pageId=${process.env.BLOTATO_FACEBOOK_PAGE_ID ?? "(missing)"}` : ""}`);

  const res = await fetch(`${BLOTATO_BASE_URL}/v2/posts`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Blotato POST /v2/posts [${platform}] HTTP ${res.status}: ${text}`
    );
  }

  const json = (await res.json()) as { postSubmissionId?: string };
  const id = json.postSubmissionId ?? "unknown";
  console.log(`[blotato] Submitted ${platform} → postSubmissionId=${id}`);
  return id;
}

/**
 * Poll the status of a submitted Blotato post.
 * Returns status, publicUrl (if published), and errorMessage (if failed).
 */
export async function getPostStatus(
  postSubmissionId: string
): Promise<BlotatoPostStatusResponse> {
  const res = await fetch(
    `${BLOTATO_BASE_URL}/v2/posts/${postSubmissionId}`,
    {
      headers: authHeaders(),
      cache: "no-store",
    } as RequestInit
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Blotato GET /v2/posts/${postSubmissionId} HTTP ${res.status}: ${text}`
    );
  }

  return (await res.json()) as BlotatoPostStatusResponse;
}

/**
 * Publish a video to all requested platforms and return per-platform results.
 *
 * Skips any platform whose account ID is not configured in env vars.
 * Caption defaults to GOT_JESUS_DEFAULT_SOCIAL_CAPTION.
 * Pass scheduledTime for scheduled posts; omit for immediate publishing.
 */
export async function publishToAll(
  videoUrl: string,
  platforms: BlotatoPlatform[],
  caption: string = GOT_JESUS_DEFAULT_SOCIAL_CAPTION,
  scheduledTime?: string
): Promise<Partial<Record<BlotatoPlatform, string>>> {
  const accountIds = getBlotatoAccountIds();
  const results: Partial<Record<BlotatoPlatform, string>> = {};

  const tasks = platforms
    .filter((p) => accountIds[p])
    .map(async (p) => {
      const submissionId = await publishPost(
        videoUrl,
        p,
        accountIds[p]!,
        caption,
        scheduledTime
      );
      results[p] = submissionId;
    });

  await Promise.all(tasks);
  return results;
}
