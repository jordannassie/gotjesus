import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getContentSlots, updateContentSlotMusic } from "@/lib/content-slots";
import type { SlotMusic } from "@/lib/content-slots";

const BUCKET = process.env.SUPABASE_VIDEO_BUCKET || "GOT JESUS";
const FOLDER = "content-slot-music";
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
];

function getStorageClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars missing.");
  return createClient(url, key);
}

// POST /api/content-slots/music
// Multipart form: slotId + file (audio)
// Uploads audio to Supabase Storage, saves metadata to gotjesus_content_slots.reference_music.
// Replaces any existing music — only one @music1 per slot.
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const slotId = formData.get("slotId");
    const file = formData.get("file");

    if (!slotId || typeof slotId !== "string") {
      return NextResponse.json({ error: "slotId is required" }, { status: 400 });
    }
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const mime = file.type;
    if (!ALLOWED_TYPES.includes(mime)) {
      return NextResponse.json(
        { error: `Invalid file type "${mime}". Allowed: mp3, wav, mp4, aac, ogg.` },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "File exceeds 25 MB limit." }, { status: 400 });
    }

    const slots = await getContentSlots("gotjesus");
    const slot = slots.find((s) => s.id === slotId);
    if (!slot) {
      return NextResponse.json({ error: "Slot not found." }, { status: 404 });
    }

    const originalName = (file as File).name ?? `music.mp3`;
    const safeFileName = `${Date.now()}-${originalName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const storagePath = `${FOLDER}/${slot.slotKey}/${safeFileName}`;

    // Remove existing music file from storage if present
    if (slot.referenceMusic?.path) {
      const supabase = getStorageClient();
      await supabase.storage.from(BUCKET).remove([slot.referenceMusic.path]).catch(() => {});
    }

    const supabase = getStorageClient();
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, arrayBuffer, { contentType: mime, upsert: false });

    if (uploadError) {
      console.error("[content-slots/music] Storage upload error:", uploadError.message);
      return NextResponse.json(
        { error: `Storage upload failed: ${uploadError.message}` },
        { status: 500 }
      );
    }

    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

    const music: SlotMusic = {
      url: publicUrl,
      path: storagePath,
      name: originalName,
      tag: "@music1",
      info: "Got Jesus song",
      mimeType: mime,
      sizeBytes: arrayBuffer.byteLength,
    };

    const updatedSlot = await updateContentSlotMusic(slotId, music);

    console.log("[content-slots/music] Music added to slot:", slot.slotKey);
    return NextResponse.json(updatedSlot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[content-slots/music] POST error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/content-slots/music
// Body: { slotId, path }
// Removes audio from Supabase Storage and clears reference_music on the slot.
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

    const supabase = getStorageClient();
    const { error: removeError } = await supabase.storage.from(BUCKET).remove([path]);
    if (removeError) {
      console.warn("[content-slots/music] Storage remove error:", removeError.message);
      // Continue — clear from DB even if storage removal failed
    }

    const updatedSlot = await updateContentSlotMusic(slotId, null);

    console.log("[content-slots/music] Music removed from slot:", slot.slotKey);
    return NextResponse.json(updatedSlot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[content-slots/music] DELETE error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
