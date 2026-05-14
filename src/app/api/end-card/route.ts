/**
 * POST /api/end-card
 * Uploads a new official end card image to Supabase Storage and saves the
 * public URL in gotjesus_brand_settings. Future generation calls will
 * automatically use the new end card.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { updateEndCardSettings } from "@/lib/brand-settings";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const BUCKET = process.env.SUPABASE_VIDEO_BUCKET || "GOT JESUS";
const FOLDER = "end-cards";

export async function POST(req: NextRequest) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 500 }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required." }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Only JPEG, PNG, and WebP images are supported." },
      { status: 400 }
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Image must be 10 MB or smaller." },
      { status: 400 }
    );
  }

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const fileName = `end-card-${Date.now()}.${ext}`;
  const storagePath = `${FOLDER}/${fileName}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const supabase = createClient(url, key);

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: file.type, upsert: true });

  if (uploadError) {
    console.error("[end-card] Storage upload error:", uploadError.message);
    return NextResponse.json(
      { error: `Storage upload failed: ${uploadError.message}` },
      { status: 500 }
    );
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  const publicUrl = urlData.publicUrl;

  try {
    await updateEndCardSettings({
      workspaceKey: "gotjesus",
      endCardImageUrl: publicUrl,
      endCardImagePath: storagePath,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[end-card] DB save error:", message);
    return NextResponse.json(
      { error: `Image uploaded but DB save failed: ${message}` },
      { status: 500 }
    );
  }

  console.log("[end-card] End card updated:", publicUrl);
  return NextResponse.json({ ok: true, url: publicUrl, path: storagePath });
}
