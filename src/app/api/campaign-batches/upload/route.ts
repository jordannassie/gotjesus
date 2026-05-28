/**
 * POST /api/campaign-batches/upload
 *
 * Accepts a reference image for a batch campaign and stores it in Supabase Storage.
 * Returns a public URL the client can use as referenceImageUrl when generating a batch plan
 * and saving it to campaign_batches.
 *
 * Multipart form fields:
 *   file         File     REQUIRED  The image to upload (jpeg/png/webp, max 10 MB)
 *   workspaceKey string   optional  default "gotjesus"
 *
 * Response:
 *   { url: string, path: string, name: string }
 *
 * Does NOT modify campaign_batches or any other table.
 * Does NOT touch content-slot upload logic.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const BUCKET = process.env.SUPABASE_VIDEO_BUCKET || "GOT JESUS";
const FOLDER = "campaign-batches";
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
  if (!url || !key) throw new Error("Supabase env vars missing.");
  return createClient(url, key);
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const workspaceKey =
      (formData.get("workspaceKey") as string | null) ?? "gotjesus";

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
      return NextResponse.json(
        { error: "File exceeds 10 MB limit." },
        { status: 400 }
      );
    }

    const ext = extFromMime(mime);
    const originalName = (file as File).name ?? `image.${ext}`;
    const safeFileName = `${Date.now()}-${originalName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const storagePath = `${FOLDER}/${workspaceKey}/${safeFileName}`;

    const supabase = getStorageClient();
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, arrayBuffer, { contentType: mime, upsert: false });

    if (uploadError) {
      console.error(
        "[campaign-batches/upload] Storage upload error:",
        uploadError.message
      );
      return NextResponse.json(
        { error: `Storage upload failed: ${uploadError.message}` },
        { status: 500 }
      );
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

    console.log(
      `[campaign-batches/upload] Uploaded ${originalName} for workspace=${workspaceKey}`
    );

    return NextResponse.json({
      url: publicUrl,
      path: storagePath,
      name: originalName,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[campaign-batches/upload] POST error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
