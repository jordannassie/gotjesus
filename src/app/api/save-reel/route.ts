/**
 * POST /api/save-reel
 * Body: { kieVideoUrl, kieTaskId?, autoPost, platforms: string[] }
 *
 * Creates a gotjesus_reels row, then invokes save-reel-background to:
 *   1. Download the Kie video and save it to Supabase Storage.
 *   2. If autoPost: publish to each enabled platform via Blotato v2.
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
    contentSlotKey?: string;
    contentSlotName?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const {
    kieVideoUrl,
    kieTaskId,
    autoPost = false,
    platforms = [],
    contentSlotKey,
    contentSlotName,
  } = body;

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

  // ── Derive base URL from the incoming request ────────────────────────────────
  // Using the request's own origin is more reliable than DEPLOY_PRIME_URL or URL
  // because those env vars can point to a different deploy (e.g. preview vs. prod).
  const requestUrl = new URL(req.url);
  const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
  const bgUrl = `${baseUrl}/.netlify/functions/save-reel-background`;

  console.log(`[save-reel route] Request origin: ${baseUrl}`);
  console.log(`[save-reel route] Background function URL: ${bgUrl}`);

  const reelId = randomUUID();
  console.log(
    `[save-reel route] Creating reel ${reelId} ` +
    `(autoPost=${autoPost}, platforms=[${platforms.join(",")}])`
  );

  // ── Create DB row so polling has something to read immediately ───────────────
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
      content_slot_key: contentSlotKey ?? null,
      content_slot_name: contentSlotName ?? null,
    });
    console.log(`[save-reel route] Created reel row ${reelId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[save-reel route] createReel failed:", message);
    return NextResponse.json(
      { error: `Failed to create reel record: ${message}` },
      { status: 500 }
    );
  }

  // ── Invoke the background function ──────────────────────────────────────────
  // Netlify background functions return 202 immediately and run asynchronously.
  console.log(`[save-reel route] Invoking save-reel-background for reel ${reelId}`);

  let bgStatus = 0;
  let bgBody = "";
  try {
    const bgRes = await fetch(bgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reelId, kieVideoUrl, autoPost, platforms }),
      // Disable Next.js fetch caching — this must always hit the function live
      cache: "no-store",
    });

    bgStatus = bgRes.status;

    // Read body for diagnostics (background fns return empty 202, but capture errors)
    try {
      bgBody = await bgRes.text();
    } catch {
      bgBody = "(could not read response body)";
    }

    console.log(
      `[save-reel route] Background invocation status: ${bgStatus} — body: ${bgBody || "(empty)"}`
    );

    // 202 = background function accepted and running async (expected)
    // 200 = function ran synchronously (shouldn't happen for -background suffix)
    // Anything else = invocation failed
    if (bgStatus !== 202 && bgStatus !== 200) {
      throw new Error(
        `save-reel-background returned HTTP ${bgStatus}: ${bgBody || "(empty body)"}`
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[save-reel route] Background invocation failed (HTTP ${bgStatus}): ${message}`
    );

    await updateReel(reelId, {
      status: "failed",
      error_message: `Failed to invoke save-reel-background: ${message}`,
    }).catch(() => {});

    return NextResponse.json(
      {
        error: `Save pipeline could not start. Background function error: ${message}`,
      },
      { status: 500 }
    );
  }

  console.log(`[save-reel route] Background function accepted reel ${reelId} (HTTP ${bgStatus})`);
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
