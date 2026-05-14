import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { updateBannerImageSettings } from "@/lib/brand-settings";

const BUCKET = process.env.SUPABASE_VIDEO_BUCKET || "GOT JESUS";
const FOLDER = "dashboard-banners";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

function getStorageClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured — SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing."
    );
  }
  return createClient(url, key);
}

function extFromMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

// POST /api/dashboard-banner
// Accepts multipart/form-data with a `file` field.
// Uploads to Supabase Storage and saves the URL to gotjesus_brand_settings.
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json(
        { error: "No file provided. Include a `file` field in the form data." },
        { status: 400 }
      );
    }

    // Validate type
    const mime = file.type;
    if (!ALLOWED_TYPES.includes(mime)) {
      return NextResponse.json(
        {
          error: `Invalid file type "${mime}". Allowed: jpeg, png, webp.`,
        },
        { status: 400 }
      );
    }

    // Validate size
    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_BYTES) {
      return NextResponse.json(
        { error: "File exceeds 10 MB limit." },
        { status: 400 }
      );
    }

    const ext = extFromMime(mime);
    const storagePath = `${FOLDER}/gotjesus-banner-${Date.now()}.${ext}`;

    console.log("[dashboard-banner] Uploading to storage:", storagePath);

    const supabase = getStorageClient();

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, arrayBuffer, {
        contentType: mime,
        upsert: false,
      });

    if (uploadError) {
      console.error("[dashboard-banner] Storage upload error:", uploadError.message);
      return NextResponse.json(
        { error: `Storage upload failed: ${uploadError.message}` },
        { status: 500 }
      );
    }

    // Build public URL
    const {
      data: { publicUrl },
    } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

    console.log("[dashboard-banner] Uploaded, public URL:", publicUrl);

    // Persist to DB
    const settings = await updateBannerImageSettings({
      workspaceKey: "gotjesus",
      bannerImageUrl: publicUrl,
      bannerImagePath: storagePath,
    });

    return NextResponse.json({
      bannerImageUrl: settings.bannerImageUrl,
      bannerImagePath: settings.bannerImagePath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[dashboard-banner] POST error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
