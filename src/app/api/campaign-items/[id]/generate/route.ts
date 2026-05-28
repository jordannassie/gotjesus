/**
 * POST /api/campaign-items/[id]/generate
 *
 * Starts Kie/Seedance video generation for a single saved campaign item.
 *
 * Flow:
 *   1. Load campaign_items row by id.
 *   2. Load parent campaign_batches row to get reference_image_url.
 *   3. Set item status = 'generating'.
 *   4. Submit job to Kie.ai via createVideoTaskWithImages().
 *   5. Store kie_task_id on the item.
 *   6. Return { item, status, kieTaskId, videoUrl }.
 *
 * The client is responsible for polling GET /api/generate-video?taskId=… until
 * the video is ready. This route does NOT poll — it fires the job and returns.
 *
 * STRICT: does NOT call Blotato, does NOT write to gotjesus_reels/Library,
 * does NOT auto-post, does NOT change existing slot generation behavior.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getCampaignItemById,
  getCampaignBatchById,
  updateCampaignItem,
} from "@/lib/campaign-batches";
import { createVideoTaskWithImages } from "@/lib/kie";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Item id is required." }, { status: 400 });
  }

  // 1 — Load the campaign item
  const item = await getCampaignItemById(id);
  if (!item) {
    return NextResponse.json({ error: "Campaign item not found." }, { status: 404 });
  }

  // Prevent re-generating a completed item
  if (item.status === "done" || item.status === "generating") {
    return NextResponse.json(
      {
        item,
        status: item.status,
        kieTaskId: item.kie_task_id ?? null,
        videoUrl: item.video_url ?? null,
      },
      { status: 409 }
    );
  }

  // 2 — Load the parent batch to get the reference image
  let referenceImageUrls: string[] = [];
  if (item.batch_id) {
    const batch = await getCampaignBatchById(item.batch_id);
    if (batch?.reference_image_url) {
      referenceImageUrls = [batch.reference_image_url];
    }
  }

  // 3 — Mark as generating
  try {
    await updateCampaignItem(id, { status: "generating" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[campaign-items/generate] updateCampaignItem error for ${id}:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // 4 — Submit to Kie.ai
  const prompt = item.prompt_text ?? "";
  const resolution = item.resolution ?? "480p";
  const duration = item.duration_seconds ?? 8;

  let taskId: string;
  try {
    taskId = await createVideoTaskWithImages(
      prompt,
      referenceImageUrls,
      resolution,
      duration
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[campaign-items/generate] Kie.ai error for item ${id}:`, message);

    // Roll back status to 'failed'
    await updateCampaignItem(id, {
      status: "failed",
      error_message: message,
    }).catch(() => {});

    return NextResponse.json({ error: message }, { status: 500 });
  }

  // 5 — Store the task id
  try {
    await updateCampaignItem(id, { kie_task_id: taskId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[campaign-items/generate] Could not save kie_task_id for ${id}:`, message);
    // Non-fatal — the job is still running; the client can poll with the taskId from this response
  }

  console.log(`[campaign-items/generate] Item ${id} → Kie task ${taskId}`);

  // 6 — Return the task id for the client to poll
  return NextResponse.json({
    item: { ...item, status: "generating", kie_task_id: taskId },
    status: "generating",
    kieTaskId: taskId,
    videoUrl: null,
  });
}
