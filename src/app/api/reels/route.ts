/**
 * GET  /api/reels          — returns up to 20 most recent reels
 * DELETE /api/reels?reelId=  — deletes the Supabase Storage file + DB row
 */

import { NextRequest, NextResponse } from "next/server";
import { getRecentReels, deleteReelRow } from "@/lib/reels-db";
import { deleteReelFile } from "@/lib/reel-storage";

export async function GET() {
  try {
    const reels = await getRecentReels(20);
    return NextResponse.json(reels);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[reels] GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const reelId = req.nextUrl.searchParams.get("reelId");
  if (!reelId)
    return NextResponse.json({ error: "reelId is required" }, { status: 400 });

  // Delete from Supabase Storage (best-effort — might not exist)
  try {
    await deleteReelFile(reelId);
  } catch (err) {
    console.warn("[reels] deleteReelFile failed (continuing):", err);
  }

  // Delete DB row
  try {
    await deleteReelRow(reelId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to delete reel record: ${message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
