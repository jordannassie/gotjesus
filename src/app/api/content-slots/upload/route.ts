import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { updateContentSlotImages, getContentSlots } from "@/lib/content-slots";
import type { SlotImage } from "@/lib/content-slots";

const BUCKET = process.env.SUPABASE_VIDEO_BUCKET || "GOT JESUS";
const FOLDER = "content-slot-images";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

function extFromMime(mime: string) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

function getStorageClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Supabase env vars missing.");
  return createClient(url, key);
}

// POST /api/content-slots/upload
// Multipart form: slotId + file
// Uploads image to Supabase Storage, appends metadata to the slot's reference_images.
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
        { error: `Invalid file type "${mime}". Allowed: jpeg, png, webp.` },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "File exceeds 10 MB limit." }, { status: 400 });
    }

    // Find the slot to get slot_key for the storage path
    const slots = await getContentSlots("gotjesus");
    const slot = slots.find((s) => s.id === slotId);
    if (!slot) {
      return NextResponse.json({ error: "Slot not found." }, { status: 404 });
    }

    const ext = extFromMime(mime);
    const fileName = `${Date.now()}-${(file as File).name ?? `image.${ext}`}`;
    const storagePath = `${FOLDER}/${slot.slotKey}/${fileName}`;

    const supabase = getStorageClient();
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, arrayBuffer, { contentType: mime, upsert: false });

    if (uploadError) {
      console.error("[content-slots/upload] Storage upload error:", uploadError.message);
      return NextResponse.json(
        { error: `Storage upload failed: ${uploadError.message}` },
        { status: 500 }
      );
    }

    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

    const newImage: SlotImage = {
      url: publicUrl,
      path: storagePath,
      name: (file as File).name ?? fileName,
    };

    const currentImages = slot.referenceImages ?? [];
    const updatedSlot = await updateContentSlotImages(slotId, [...currentImages, newImage]);

    console.log("[content-slots/upload] Image added to slot:", slot.slotKey);
    return NextResponse.json(updatedSlot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[content-slots/upload] POST error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
