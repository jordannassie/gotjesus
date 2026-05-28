/**
 * POST /api/campaign-batches
 * Saves an OpenAI-generated batch plan to campaign_batches + campaign_items.
 * Does NOT call Kie, does NOT generate videos, does NOT touch gotjesus_reels.
 *
 * GET /api/campaign-batches?workspaceKey=
 * Returns recent batches for a workspace (most recent first).
 *
 * POST body:
 *   workspaceKey      string    optional  default "gotjesus"
 *   brandName         string    optional
 *   batchTitle        string    optional
 *   batchType         string    optional
 *   instruction       string    optional
 *   referenceImageUrl string    optional
 *   items             BatchItem[]  REQUIRED
 */

import { NextRequest, NextResponse } from "next/server";
import {
  createCampaignBatchWithItems,
  getCampaignBatches,
  type CreateItemData,
} from "@/lib/campaign-batches";

export async function POST(req: NextRequest) {
  let body: {
    workspaceKey?: string;
    brandName?: string;
    batchTitle?: string;
    batchType?: string;
    instruction?: string;
    referenceImageUrl?: string;
    items?: CreateItemData[];
  };

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const {
    workspaceKey = "gotjesus",
    brandName,
    batchTitle,
    batchType,
    instruction,
    referenceImageUrl,
    items,
  } = body;

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json(
      { error: "items array is required and must not be empty." },
      { status: 400 }
    );
  }

  try {
    const result = await createCampaignBatchWithItems({
      workspaceKey,
      brandName,
      batchTitle,
      batchType,
      instruction,
      referenceImageUrl,
      items,
    });

    console.log(
      `[campaign-batches] Saved batch ${result.batch.id} ` +
      `with ${result.items.length} items for workspace=${workspaceKey}`
    );

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[campaign-batches] POST error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const workspaceKey = req.nextUrl.searchParams.get("workspaceKey") ?? "gotjesus";

  try {
    const batches = await getCampaignBatches(workspaceKey);
    return NextResponse.json(batches);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[campaign-batches] GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
