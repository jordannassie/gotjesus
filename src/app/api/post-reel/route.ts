/**
 * POST /api/post-reel
 * Body: { reelId: string }
 *
 * Immediately posts an existing saved reel to all currently-enabled social
 * platforms (determined by gotjesus_posting_settings).
 *
 * Requires BLOTATO_API_KEY and at least one platform account ID to be set.
 * Uses the reel's saved caption_used as the post caption.
 *
 * Returns: { posted: string[], errors: Record<string, string> }
 */

import { NextRequest, NextResponse } from "next/server";
import { getReel, updateReel } from "@/lib/reels-db";
import { getPostingSettings } from "@/lib/posting-settings";
import { publishToAll, isBlotatoConnected, type BlotatoPlatform } from "@/lib/blotato";
import { GOT_JESUS_DEFAULT_SOCIAL_CAPTION } from "@/lib/social-caption";

export async function POST(req: NextRequest) {
  let body: { reelId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { reelId } = body;
  if (!reelId)
    return NextResponse.json({ error: "reelId is required" }, { status: 400 });

  if (!isBlotatoConnected())
    return NextResponse.json(
      { error: "Blotato is not configured. Check BLOTATO_API_KEY and platform account IDs." },
      { status: 503 }
    );

  // ── Fetch reel ───────────────────────────────────────────────────────────────
  const reel = await getReel(reelId);
  if (!reel)
    return NextResponse.json({ error: "Reel not found" }, { status: 404 });

  const videoUrl = reel.saved_video_url ?? reel.kie_video_url;
  if (!videoUrl)
    return NextResponse.json({ error: "Reel has no video URL" }, { status: 400 });

  // ── Determine enabled platforms ──────────────────────────────────────────────
  const settings = await getPostingSettings();
  const platforms: BlotatoPlatform[] = [];
  if (settings.instagramEnabled && process.env.BLOTATO_INSTAGRAM_ACCOUNT_ID)
    platforms.push("instagram");
  if (settings.tiktokEnabled && process.env.BLOTATO_TIKTOK_ACCOUNT_ID)
    platforms.push("tiktok");
  if (settings.youtubeEnabled && process.env.BLOTATO_YOUTUBE_ACCOUNT_ID)
    platforms.push("youtube");

  if (platforms.length === 0)
    return NextResponse.json(
      { error: "No social platforms are enabled. Enable at least one platform in Connections settings." },
      { status: 400 }
    );

  const caption = reel.caption_used || GOT_JESUS_DEFAULT_SOCIAL_CAPTION;

  console.log(
    `[post-reel] Posting reel ${reelId} to [${platforms.join(", ")}] immediately`
  );

  // ── Publish to all platforms ─────────────────────────────────────────────────
  const submissionIds: Partial<Record<BlotatoPlatform, string>> = {};
  const errors: Partial<Record<BlotatoPlatform, string>> = {};

  await Promise.all(
    platforms.map(async (platform) => {
      try {
        const results = await publishToAll(videoUrl, [platform], caption);
        if (results[platform]) submissionIds[platform] = results[platform]!;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[post-reel] ${platform} failed:`, msg);
        errors[platform] = msg;
      }
    })
  );

  // ── Update reel row ──────────────────────────────────────────────────────────
  const posted = Object.keys(submissionIds) as BlotatoPlatform[];
  if (posted.length > 0) {
    await updateReel(reelId, {
      blotato_status: "submitted",
      status: "posted",
      instagram_post_submission_id: submissionIds.instagram ?? reel.instagram_post_submission_id,
      tiktok_post_submission_id: submissionIds.tiktok ?? reel.tiktok_post_submission_id,
      youtube_post_submission_id: submissionIds.youtube ?? reel.youtube_post_submission_id,
      instagram_enabled: platforms.includes("instagram") || reel.instagram_enabled,
      tiktok_enabled: platforms.includes("tiktok") || reel.tiktok_enabled,
      youtube_enabled: platforms.includes("youtube") || reel.youtube_enabled,
    }).catch((err) => {
      console.warn("[post-reel] updateReel failed (non-fatal):", err);
    });
  }

  console.log(
    `[post-reel] Done. Posted to [${posted.join(", ")}]. Errors: ${JSON.stringify(errors)}`
  );

  if (posted.length === 0) {
    const firstError = Object.values(errors)[0] ?? "Unknown posting error";
    return NextResponse.json({ error: firstError, errors }, { status: 502 });
  }

  return NextResponse.json({
    posted,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
    submissionIds,
  });
}
