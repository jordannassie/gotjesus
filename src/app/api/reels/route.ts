/**
 * GET    /api/reels           — up to 50 most recent non-deleted reels
 * PATCH  /api/reels           — toggle favorite (body: { reelId, isFavorite })
 * DELETE /api/reels?reelId=   — soft-deletes the DB row (sets deleted_at) + removes storage file
 */

import { NextRequest, NextResponse } from "next/server";
import { getRecentReels, updateReel } from "@/lib/reels-db";
import { deleteReelFile } from "@/lib/reel-storage";

export async function GET(req: NextRequest) {
  const workspaceKey = req.nextUrl.searchParams.get("workspaceKey") ?? "gotjesus";
  try {
    const reels = await getRecentReels(50, workspaceKey);
    return NextResponse.json(reels);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[reels] GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as { reelId?: string; isFavorite?: boolean };
    const { reelId, isFavorite } = body;

    if (!reelId) {
      return NextResponse.json({ error: "reelId is required" }, { status: 400 });
    }
    if (isFavorite === undefined) {
      return NextResponse.json({ error: "isFavorite is required" }, { status: 400 });
    }

    await updateReel(reelId, { is_favorite: isFavorite });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[reels] PATCH error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const reelId = req.nextUrl.searchParams.get("reelId");
  if (!reelId) {
    return NextResponse.json({ error: "reelId is required" }, { status: 400 });
  }

  // Remove from Supabase Storage (best-effort)
  try {
    await deleteReelFile(reelId);
  } catch (err) {
    console.warn("[reels] deleteReelFile failed (continuing):", err);
  }

  // Soft-delete: set deleted_at rather than hard-deleting the DB row
  try {
    await updateReel(reelId, { deleted_at: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to delete reel record: ${message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
