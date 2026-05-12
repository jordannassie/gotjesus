/**
 * POST /api/save-reel
 * Body: { kieVideoUrl, kieTaskId?, autoPost, platforms: string[] }
 *
 * Creates a gotjesus_reels row, then invokes save-reel-background to:
 *   1. Download the Kie video and save it to Supabase Storage.
 *   2. If autoPost: upload to Blotato and publish to each enabled platform.
 *
 * Returns: { reelId }
 *
 * GET /api/save-reel?reelId=...
 * Returns the current gotjesus_reels row for polling.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createReel, getReel, updateReel } from "@/lib/reels-db";
import { GOT_JESUS_DEFAULT_SOCIAL_CAPTION } from "@/lib/social-caption";
import { CROSS_DISCOVERY_PROMPT } from "@/lib/cross-prompt";

export async function POST(req: NextRequest) {
  let body: {
    kieVideoUrl?: string;
    kieTaskId?: string;
    autoPost?: boolean;
    platforms?: string[];
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { kieVideoUrl, kieTaskId, autoPost = false, platforms = [] } = body;

  if (!kieVideoUrl)
    return NextResponse.json({ error: "kieVideoUrl is required" }, { status: 400 });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json(
      {
        error:
          "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
      },
      { status: 500 }
    );

  const siteUrl = process.env.DEPLOY_PRIME_URL || process.env.URL || "";
  if (!siteUrl)
    return NextResponse.json(
      {
        error:
          "DEPLOY_PRIME_URL / URL env var is not set. " +
          "Run via `netlify dev` locally or deploy to Netlify.",
      },
      { status: 500 }
    );

  const reelId = randomUUID();
  console.log(`[save-reel] Creating reel ${reelId} (autoPost=${autoPost}, platforms=${platforms.join(",")})`);

  // Create the DB row first so polling has something to read immediately
  try {
    await createReel({
      id: reelId,
      status: "saving",
      generation_source: "manual",
      kie_task_id: kieTaskId ?? null,
      kie_video_url: kieVideoUrl,
      caption_used: GOT_JESUS_DEFAULT_SOCIAL_CAPTION,
      prompt_used: CROSS_DISCOVERY_PROMPT,
      instagram_enabled: platforms.includes("instagram"),
      tiktok_enabled: platforms.includes("tiktok"),
      youtube_enabled: platforms.includes("youtube"),
    });
    console.log(`[save-reel] DB row created for reel ${reelId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[save-reel] createReel failed:", message);
    return NextResponse.json(
      { error: `Failed to create reel record: ${message}` },
      { status: 500 }
    );
  }

  // Invoke the background function — returns 202 immediately
  const bgUrl = `${siteUrl}/.netlify/functions/save-reel-background`;
  try {
    const bgRes = await fetch(bgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reelId, kieVideoUrl, autoPost, platforms }),
    });
    if (!bgRes.ok && bgRes.status !== 202) {
      throw new Error(`Background function returned HTTP ${bgRes.status}`);
    }
    console.log(`[save-reel] Background function invoked for reel ${reelId} (HTTP ${bgRes.status})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[save-reel] Background function invoke failed:", message);
    await updateReel(reelId, {
      status: "failed",
      error_message: `Background function error: ${message}`,
    }).catch(() => {});
    return NextResponse.json(
      { error: `Could not start save pipeline: ${message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ reelId });
}

export async function GET(req: NextRequest) {
  const reelId = req.nextUrl.searchParams.get("reelId");
  if (!reelId)
    return NextResponse.json({ error: "reelId is required" }, { status: 400 });

  const reel = await getReel(reelId);
  if (!reel) {
    // Row might not have been written yet — return safe pending response
    return NextResponse.json({ id: reelId, status: "saving", saved_video_url: null });
  }
  return NextResponse.json(reel);
}
