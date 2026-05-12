/**
 * Canonical asset configuration for the GotJesus Reel Engine.
 *
 * GOT_JESUS_ENDCARD_SUPABASE_URL
 *   Permanent remote source. The official Got Jesus end card image hosted on
 *   Supabase Storage. Treat this as the canonical source of truth for the asset.
 *   Used as a fallback when the local asset is unavailable (e.g. cold-start issues
 *   in serverless environments where included_files hasn't resolved).
 *
 * GOT_JESUS_ENDCARD_LOCAL_PATH
 *   Local static asset bundled with the Next.js app at public/gotjesus-endcard.png.
 *   This is the preferred source for FFmpeg video processing — it avoids a network
 *   fetch on every generation and guarantees the exact correct asset is used.
 *   Included in the Netlify background function bundle via `included_files` in netlify.toml.
 *   In Next.js pages, reference this asset via the public URL: /gotjesus-endcard.png.
 */

export const GOT_JESUS_ENDCARD_SUPABASE_URL =
  "https://phhczohqidgrvcmszets.supabase.co/storage/v1/object/public/GOT%20JESUS/image/gotjesus-endcard.png";

/**
 * Path of the local end card asset relative to the project root.
 * Available as a public static file at runtime: /gotjesus-endcard.png
 */
export const GOT_JESUS_ENDCARD_LOCAL_PATH = "public/gotjesus-endcard.png";
