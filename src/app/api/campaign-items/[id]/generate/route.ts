/**
 * POST /api/campaign-items/[id]/generate
 *
 * Starts Kie/Seedance video generation for a single saved campaign item.
 * Follows the same pattern as the Content Engine:
 *   - Loads campaign_item + parent batch for reference images
 *   - Appends the active end-card URL (same as Content Engine)
 *   - Submits job to Kie.ai via createVideoTaskWithImages()
 *   - Stores kie_task_id and sets item status = 'generating'
 *   - Returns { kieTaskId } for client-side polling
 *
 * The client polls GET /api/generate-video?taskId=… until the video is ready,
 * then calls POST /api/campaign-items/[id]/save-to-library to persist it.
 *
 * STRICT: does NOT call Blotato, does NOT write to gotjesus_reels,
 * does NOT auto-post, does NOT change Content Engine behaviour.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getCampaignItemById,
  getCampaignBatchById,
  updateCampaignItem,
} from "@/lib/campaign-batches";
import { createVideoTaskWithImages } from "@/lib/kie";
import { getActiveEndCardUrl } from "@/lib/brand-settings";

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

  // Prevent re-submitting a job that is already running or done
  if (item.status === "generating") {
    return NextResponse.json(
      { item, status: "generating", kieTaskId: item.kie_task_id, videoUrl: null },
      { status: 409 }
    );
  }
  if (item.status === "complete" || item.status === "done") {
    return NextResponse.json(
      { item, status: item.status, kieTaskId: item.kie_task_id, videoUrl: item.video_url },
      { status: 409 }
    );
  }

  // 2 — Build reference image list
  //     batch.reference_image_url → filtered by Kie ratio check inside createVideoTaskWithImages
  //     end-card URL appended last (same as Content Engine)
  let referenceImageUrls: string[] = [];
  if (item.batch_id) {
    const batch = await getCampaignBatchById(item.batch_id);
    if (batch?.reference_image_url) {
      referenceImageUrls = [batch.reference_image_url];
    }
  }

  const endCardUrl = await getActiveEndCardUrl();
  if (endCardUrl) referenceImageUrls.push(endCardUrl);

  // 3 — Mark item as generating
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
    await updateCampaignItem(id, { status: "failed", error_message: message }).catch(() => {});
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // 5 — Persist task id
  try {
    await updateCampaignItem(id, { kie_task_id: taskId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[campaign-items/generate] Could not save kie_task_id for ${id}:`, message);
    // Non-fatal — the job is running; client can poll with the taskId from this response
  }

  console.log(`[campaign-items/generate] Item ${id} → Kie task ${taskId}`);

  return NextResponse.json({
    item: { ...item, status: "generating", kie_task_id: taskId },
    status: "generating",
    kieTaskId: taskId,
    videoUrl: null,
  });
}
