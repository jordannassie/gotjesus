import { NextRequest, NextResponse } from "next/server";
import {
  getContentSlots,
  seedDefaultContentSlotsIfMissing,
  upsertContentSlot,
  createContentSlot,
  deleteContentSlot,
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

// POST /api/content-slots
// Creates a new content slot. Body is optional overrides for default values.
// Also handles Duplicate Section — pass overrides with source slot's data.
// workspaceKey in body determines which brand the slot belongs to.
// Defaults to "gotjesus" when missing so old callers without it still work.
export async function POST(req: NextRequest) {
  try {
    let overrides: Partial<ContentSlot> = {};
    try {
      overrides = (await req.json()) as Partial<ContentSlot>;
    } catch {
      // empty body → use all defaults
    }

    const workspaceKey = overrides.workspaceKey ?? "gotjesus";
    const slot = await createContentSlot(workspaceKey, overrides);
    return NextResponse.json(slot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[content-slots] POST error:", message);
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

// DELETE /api/content-slots?id=<slotId>
// Permanently deletes a content slot config row.
// Does NOT delete generated reels or Supabase video files.
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    await deleteContentSlot(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[content-slots] DELETE error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
