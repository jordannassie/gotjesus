/**
 * POST /api/campaign-items/[id]/save-to-library
 *
 * Called by the client after polling confirms a Kie video is ready.
 * Body: { kieVideoUrl: string, kieTaskId?: string }
 *
 * Flow (mirrors save-reel for the Content Engine):
 *   1. Load campaign_item + parent batch.
 *   2. Update campaign_items: status='complete', video_url, kie_task_id.
 *   3. Create a gotjesus_reels row with source='batch' and batch provenance.
 *   4. Trigger save-reel-background Netlify function (downloads + persists video).
 *   5. Return { reelId }.
 *
 * STRICT: does NOT call Blotato, does NOT auto-post.
 * Existing Library Post Now behaviour is completely unchanged.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  getCampaignItemById,
  getCampaignBatchById,
  updateCampaignItem,
} from "@/lib/campaign-batches";
import { createReel } from "@/lib/reels-db";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Item id is required." }, { status: 400 });
  }

  // ── Parse body ───────────────────────────────────────────────────────────────
  let kieVideoUrl: string;
  let kieTaskId: string | undefined;
  try {
    const body = (await req.json()) as { kieVideoUrl?: string; kieTaskId?: string };
    kieVideoUrl = body.kieVideoUrl ?? "";
    kieTaskId = body.kieTaskId;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!kieVideoUrl) {
    return NextResponse.json({ error: "kieVideoUrl is required." }, { status: 400 });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  // ── Load campaign item ───────────────────────────────────────────────────────
  const item = await getCampaignItemById(id);
  if (!item) {
    return NextResponse.json({ error: "Campaign item not found." }, { status: 404 });
  }

  // ── Load parent batch ────────────────────────────────────────────────────────
  let captionUsed = item.caption ?? "";
  let batchId: string | null = item.batch_id ?? null;
  if (batchId) {
    const batch = await getCampaignBatchById(batchId);
    if (batch) {
      if (!captionUsed) captionUsed = batch.batch_title ?? "";
    }
  }

  // ── Update campaign item ─────────────────────────────────────────────────────
  try {
    await updateCampaignItem(id, {
      status: "complete",
      video_url: kieVideoUrl,
      kie_task_id: kieTaskId ?? item.kie_task_id ?? null,
    } as Parameters<typeof updateCampaignItem>[1]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[save-to-library] updateCampaignItem(${id}) failed:`, message);
    // Non-fatal — proceed with Library save anyway
  }

  // ── Create gotjesus_reels row ────────────────────────────────────────────────
  const reelId = randomUUID();

  try {
    await createReel({
      id: reelId,
      status: "saving",
      generation_source: "manual",
      source: "batch",
      kie_task_id: kieTaskId ?? item.kie_task_id ?? null,
      kie_video_url: kieVideoUrl,
      caption_used: captionUsed || "Batch video",
      prompt_used: item.prompt_text ?? null,
      instagram_enabled: false,
      tiktok_enabled: false,
      youtube_enabled: false,
      workspace_key: item.workspace_key,
      batch_id: batchId,
      campaign_item_id: id,
      ad_type: item.ad_type ?? null,
      hook: item.hook ?? null,
    });
    console.log(`[save-to-library] Created reel row ${reelId} for campaign item ${id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[save-to-library] createReel failed for item ${id}:`, message);
    return NextResponse.json(
      { error: `Failed to create Library entry: ${message}` },
      { status: 500 }
    );
  }

  // ── Trigger save-reel-background (downloads + persists video to Supabase Storage)
  const requestUrl = new URL(req.url);
  const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
  const bgUrl = `${baseUrl}/.netlify/functions/save-reel-background`;

  console.log(`[save-to-library] Invoking background function: ${bgUrl}`);

  try {
    const bgRes = await fetch(bgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reelId, kieVideoUrl, autoPost: false, platforms: [] }),
      cache: "no-store",
    });

    if (bgRes.status !== 202 && bgRes.status !== 200) {
      const text = await bgRes.text().catch(() => "");
      console.warn(
        `[save-to-library] Background function HTTP ${bgRes.status}: ${text}. ` +
        `Reel row ${reelId} was created — video will remain at Kie URL until reprocessed.`
      );
      // Non-fatal: the reel row exists, Library will show kie_video_url as fallback
    } else {
      console.log(`[save-to-library] Background function accepted reel ${reelId} (HTTP ${bgRes.status})`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[save-to-library] Background function error for ${reelId}:`, message);
    // Non-fatal — reel row exists; video visible in Library via kie_video_url
  }

  return NextResponse.json({ reelId, itemId: id });
}
