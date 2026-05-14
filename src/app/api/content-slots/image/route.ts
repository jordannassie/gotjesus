import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getContentSlots, updateContentSlotImages } from "@/lib/content-slots";

const BUCKET = process.env.SUPABASE_VIDEO_BUCKET || "GOT JESUS";

function getStorageClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars missing.");
  return createClient(url, key);
}

// DELETE /api/content-slots/image
// Body: { slotId, path }
// Removes the image from Supabase Storage and from the slot's reference_images JSON.
export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json()) as { slotId?: string; path?: string };
    const { slotId, path } = body;

    if (!slotId || !path) {
      return NextResponse.json(
        { error: "slotId and path are required" },
        { status: 400 }
      );
    }

    const slots = await getContentSlots("gotjesus");
    const slot = slots.find((s) => s.id === slotId);
    if (!slot) {
      return NextResponse.json({ error: "Slot not found." }, { status: 404 });
    }

    // Remove from storage
    const supabase = getStorageClient();
    const { error: removeError } = await supabase.storage
      .from(BUCKET)
      .remove([path]);

    if (removeError) {
      console.warn("[content-slots/image] Storage remove error:", removeError.message);
      // Continue — remove from DB even if storage removal failed
    }

    // Remove from slot JSON
    const updatedImages = (slot.referenceImages ?? []).filter((img) => img.path !== path);
    const updatedSlot = await updateContentSlotImages(slotId, updatedImages);

    console.log("[content-slots/image] Image removed from slot:", slot.slotKey);
    return NextResponse.json(updatedSlot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[content-slots/image] DELETE error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
