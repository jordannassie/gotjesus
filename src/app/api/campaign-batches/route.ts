/**
 * POST /api/campaign-batches
 * Saves an OpenAI-generated batch plan to campaign_batches + campaign_items.
 * Does NOT call Kie, does NOT generate videos, does NOT touch gotjesus_reels.
 *
 * GET /api/campaign-batches?workspaceKey=
 * Returns recent batches for a workspace (most recent first).
 *
 * POST body:
 *   workspaceKey      string        optional  default "gotjesus"
 *   brandName         string        optional
 *   batchTitle        string        optional
 *   batchType         string        optional
 *   instruction       string        optional
 *   referenceImageUrl string        optional
 *   items             object[]      REQUIRED  camelCase fields accepted
 */

import { NextRequest, NextResponse } from "next/server";
import {
  createCampaignBatchWithItems,
  getCampaignBatches,
  type CreateItemData,
} from "@/lib/campaign-batches";

/**
 * Normalise one item from the POST body into the CreateItemData shape
 * the lib expects. Accepts both camelCase (from BatchTab) and handles
 * any fields that might be missing.
 */
function normaliseItem(raw: Record<string, unknown>, index: number): CreateItemData {
  // Accept camelCase or snake_case for each field
  return {
    title:         String(raw["title"] ?? `Concept ${index + 1}`),
    adType:        String(raw["adType"] ?? raw["ad_type"] ?? "Lifestyle"),
    hook:          String(raw["hook"] ?? ""),
    promptText:    String(raw["promptText"] ?? raw["prompt_text"] ?? ""),
    caption:       String(raw["caption"] ?? ""),
    reason:        String(raw["reason"] ?? ""),
    platform:      String(raw["platform"] ?? "All"),
    durationSeconds: Number(raw["durationSeconds"] ?? raw["duration_seconds"] ?? 8),
    aspectRatio:   String(raw["aspectRatio"] ?? raw["aspect_ratio"] ?? "9:16"),
    resolution:    String(raw["resolution"] ?? "480p"),
    model:         String(raw["model"] ?? "Seedance 2.0 Fast"),
  };
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;

  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const workspaceKey      = String(body["workspaceKey"] ?? "gotjesus");
  const brandName         = body["brandName"]         ? String(body["brandName"])         : undefined;
  const batchTitle        = body["batchTitle"]         ? String(body["batchTitle"])         : undefined;
  const batchType         = body["batchType"]          ? String(body["batchType"])          : undefined;
  const instruction       = body["instruction"]        ? String(body["instruction"])        : undefined;
  const referenceImageUrl = body["referenceImageUrl"]  ? String(body["referenceImageUrl"])  : undefined;
  const postCaption       = body["postCaption"]        ? String(body["postCaption"])        : undefined;
  const rawReferenceImages = Array.isArray(body["referenceImages"]) ? body["referenceImages"] as Array<Record<string, unknown>> : undefined;
  const referenceImages = rawReferenceImages?.map((img) => ({
    tag:  img["tag"]  ? String(img["tag"])  : "@product1",
    info: img["info"] ? String(img["info"]) : undefined,
    name: img["name"] ? String(img["name"]) : undefined,
    url:  img["url"]  ? String(img["url"])  : "",
  }));
  const rawItems          = body["items"];

  // Validate items
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return NextResponse.json(
      { error: "items array is required and must not be empty." },
      { status: 400 }
    );
  }

  // Normalise each item — tolerates missing/extra fields
  const items: CreateItemData[] = (rawItems as Record<string, unknown>[]).map(
    (raw, i) => normaliseItem(raw, i)
  );

  console.log(
    `[campaign-batches] POST workspace=${workspaceKey} items=${items.length} batchType="${batchType ?? ""}"`
  );

  try {
    const result = await createCampaignBatchWithItems({
      workspaceKey,
      brandName,
      batchTitle,
      batchType,
      instruction,
      referenceImageUrl,
      postCaption,
      referenceImages,
      items,
    });

    console.log(
      `[campaign-batches] Saved batch ${result.batch.id} with ${result.items.length} items`
    );

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[campaign-batches] POST failed:", message, error);
    return NextResponse.json(
      {
        error: "Failed to save campaign batch.",
        detail: message,
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const workspaceKey = req.nextUrl.searchParams.get("workspaceKey") ?? "gotjesus";

  try {
    const batches = await getCampaignBatches(workspaceKey);
    return NextResponse.json(batches);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[campaign-batches] GET failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
