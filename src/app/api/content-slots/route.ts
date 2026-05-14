import { NextRequest, NextResponse } from "next/server";
import {
  getContentSlots,
  seedDefaultContentSlotsIfMissing,
  upsertContentSlot,
  type ContentSlot,
} from "@/lib/content-slots";

// GET /api/content-slots?workspaceKey=gotjesus
// Returns all content slots for the workspace, seeding defaults if none exist.
export async function GET(req: NextRequest) {
  const workspaceKey =
    req.nextUrl.searchParams.get("workspaceKey") ?? "gotjesus";

  try {
    await seedDefaultContentSlotsIfMissing(workspaceKey);
    const slots = await getContentSlots(workspaceKey);
    return NextResponse.json(slots);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[content-slots] GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/content-slots
// Updates a single content slot by id.
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<ContentSlot> & { id: string };

    if (!body.id) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 }
      );
    }

    const updated = await upsertContentSlot(body);
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[content-slots] PATCH error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
