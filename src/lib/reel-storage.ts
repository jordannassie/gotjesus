/**
 * Supabase Storage helpers for the GotJesus video library — server-side only.
 *
 * Videos are stored in:
 *   Bucket : SUPABASE_VIDEO_BUCKET  (default: "GOT JESUS")
 *   Folder : SUPABASE_VIDEO_FOLDER  (default: "gotjesus-videos")
 *   Path   : gotjesus-videos/<reelId>.mp4
 *
 * Example public URL:
 *   https://<project>.supabase.co/storage/v1/object/public/GOT%20JESUS/gotjesus-videos/<id>.mp4
 *
 * The bucket must have Public access enabled in Supabase.
 */

import { createClient } from "@supabase/supabase-js";

export const STORAGE_BUCKET =
  process.env.SUPABASE_VIDEO_BUCKET || "GOT JESUS";
export const STORAGE_FOLDER =
  process.env.SUPABASE_VIDEO_FOLDER || "gotjesus-videos";

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error(
      "Supabase is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  return createClient(url, key);
}

/**
 * Downloads the Kie-generated video from its temporary URL and uploads it
 * to Supabase Storage under the configured bucket/folder path.
 * Returns the permanent public Supabase URL.
 */
export async function downloadAndSaveReel(
  kieVideoUrl: string,
  reelId: string
): Promise<string> {
  console.log(`[reel-storage] Downloading Kie video for reel ${reelId}`);
  const res = await fetch(kieVideoUrl);
  if (!res.ok)
    throw new Error(
      `Failed to download Kie video: HTTP ${res.status} ${res.statusText}`
    );
  const buffer = Buffer.from(await res.arrayBuffer());
  console.log(
    `[reel-storage] Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)} MB`
  );

  const supabase = getClient();
  const filePath = `${STORAGE_FOLDER}/${reelId}.mp4`;

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(filePath, buffer, { contentType: "video/mp4", upsert: true });

  if (error)
    throw new Error(
      `Supabase upload failed (bucket="${STORAGE_BUCKET}", path="${filePath}"): ${error.message}`
    );

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filePath);
  console.log(`[reel-storage] Saved reel ${reelId} → ${data.publicUrl}`);
  return data.publicUrl;
}

/**
 * Deletes a reel MP4 file from Supabase Storage.
 * Silently ignores "not found" errors.
 */
export async function deleteReelFile(reelId: string): Promise<void> {
  const supabase = getClient();
  const filePath = `${STORAGE_FOLDER}/${reelId}.mp4`;
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .remove([filePath]);
  if (error) {
    console.warn(`[reel-storage] deleteReelFile(${reelId}):`, error.message);
  }
}
