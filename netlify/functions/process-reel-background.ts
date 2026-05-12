/**
 * Netlify Background Function — process-reel-background
 *
 * Invoked by POST /api/finalize-video. Returns 202 immediately and runs
 * asynchronously for up to 15 minutes (Netlify background function limit).
 *
 * Flow:
 *   1. Download raw Kie video to /tmp
 *   2. Resolve official Got Jesus end card:
 *        - Preferred: local asset bundled via netlify.toml included_files
 *          (public/gotjesus-endcard.png — no network fetch, guaranteed correct asset)
 *        - Fallback: canonical Supabase URL if local file is not accessible
 *   3. Create 1-second silent end card video (libx264 + AAC, matching resolution)
 *   4. Concatenate raw video + end card → final 8-second MP4
 *   5. Upload final MP4 to Supabase Storage
 *   6. Write job status to Supabase after each stage
 */

import type { Handler, HandlerEvent } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import ffmpegStatic from "ffmpeg-static";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdir, rm, chmod, writeFile, copyFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// Canonical end card sources (inlined — background functions can't import from src/lib/)
const GOT_JESUS_ENDCARD_SUPABASE_URL =
  "https://phhczohqidgrvcmszets.supabase.co/storage/v1/object/public/GOT%20JESUS/image/gotjesus-endcard.png";
const GOT_JESUS_ENDCARD_LOCAL_PATH = join(process.cwd(), "public", "gotjesus-endcard.png");

const execFileAsync = promisify(execFile);

// ─── Supabase helpers (inlined — background functions can't import from src/) ──

type JobStatusValue =
  | "pending"
  | "processing"
  | "appending_endcard"
  | "uploading"
  | "complete"
  | "failed";

interface JobStatus {
  status: JobStatusValue;
  url?: string;
  error?: string;
  updatedAt: number;
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  }
  return createClient(url, key);
}

async function writeStatus(
  jobId: string,
  data: Omit<JobStatus, "updatedAt">
): Promise<void> {
  const supabase = getSupabase();
  const payload: JobStatus = { ...data, updatedAt: Date.now() };
  const bucket = process.env.SUPABASE_VIDEO_BUCKET || "gotjesus-videos";

  const { error } = await supabase.storage
    .from(bucket)
    .upload(`status/${jobId}.json`, Buffer.from(JSON.stringify(payload)), {
      contentType: "application/json",
      upsert: true,
    });

  if (error) {
    console.error(`[process-reel] writeStatus(${jobId}, ${data.status}) FAILED:`, error.message);
    throw new Error(`writeStatus failed: ${error.message}`);
  }

  console.log(`[process-reel] writeStatus(${jobId}): ${data.status}`);
}

// ─── Download helper ──────────────────────────────────────────────────────────

async function downloadToFile(url: string, dest: string): Promise<void> {
  console.log(`[process-reel] Downloading: ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed [${url}]: HTTP ${res.status} ${res.statusText}`);
  }
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`[process-reel] Download complete → ${dest}`);
}

// ─── FFmpeg helper ────────────────────────────────────────────────────────────

async function runFfmpeg(args: string[]): Promise<void> {
  if (!ffmpegStatic) throw new Error("ffmpeg-static binary not found.");

  console.log(`[process-reel] FFmpeg args: ${args.join(" ")}`);

  const { stderr } = await execFileAsync(ffmpegStatic, args, {
    maxBuffer: 100 * 1024 * 1024, // 100 MB — FFmpeg logs to stderr
  });

  if (stderr) {
    // FFmpeg always writes to stderr even on success — log last 1kb only
    console.log("[ffmpeg]", stderr.slice(-1000));
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

const handler: Handler = async (event: HandlerEvent) => {
  let body: { jobId?: string; rawVideoUrl?: string } = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: "Invalid JSON body" };
  }

  const { jobId, rawVideoUrl } = body;
  if (!jobId || !rawVideoUrl) {
    return { statusCode: 400, body: "Missing jobId or rawVideoUrl" };
  }

  console.log(`[process-reel] Starting job ${jobId}`);
  console.log(`[process-reel] Raw video URL: ${rawVideoUrl}`);

  const bucket = process.env.SUPABASE_VIDEO_BUCKET || "gotjesus-videos";
  const tmpDir = join(tmpdir(), `reel-${randomUUID()}`);
  const rawPath = join(tmpDir, "raw.mp4");
  const endCardPath = join(tmpDir, "endcard.png");
  const endCardVideoPath = join(tmpDir, "endcard.mp4");
  const outputPath = join(tmpDir, "final.mp4");

  try {
    await mkdir(tmpDir, { recursive: true });
    console.log(`[process-reel] Working directory: ${tmpDir}`);

    // Ensure ffmpeg binary is executable on Lambda
    if (ffmpegStatic) {
      await chmod(ffmpegStatic, 0o755).catch(() => {});
      console.log(`[process-reel] FFmpeg binary: ${ffmpegStatic}`);
    }

    // ── Stage 1: Processing ───────────────────────────────────────────────────
    await writeStatus(jobId, { status: "processing" });

    // Download raw video from Kie.ai
    console.log("[process-reel] Stage 1: Downloading raw video");
    await downloadToFile(rawVideoUrl, rawPath);

    // ── Stage 2: Resolve end card ─────────────────────────────────────────────
    console.log("[process-reel] Stage 2: Resolving end card asset");
    try {
      await access(GOT_JESUS_ENDCARD_LOCAL_PATH);
      await copyFile(GOT_JESUS_ENDCARD_LOCAL_PATH, endCardPath);
      console.log("[process-reel] Using local bundled end card asset");
    } catch {
      console.log("[process-reel] Local end card not found — downloading from canonical Supabase URL");
      await downloadToFile(GOT_JESUS_ENDCARD_SUPABASE_URL, endCardPath);
    }

    // ── Stage 3: Create end card segment ─────────────────────────────────────
    await writeStatus(jobId, { status: "appending_endcard" });
    console.log("[process-reel] Stage 3: Creating 1-second end card video segment");

    const resolution = process.env.KIE_VIDEO_RESOLUTION || "720p";
    const width = resolution === "480p" ? 480 : 720;
    const height = resolution === "480p" ? 854 : 1280;
    const scaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;

    await runFfmpeg([
      "-loop", "1",
      "-i", endCardPath,
      "-f", "lavfi",
      "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-t", "1",
      "-vf", scaleFilter,
      "-c:v", "libx264",
      "-c:a", "aac",
      "-pix_fmt", "yuv420p",
      "-r", "24",
      "-y",
      endCardVideoPath,
    ]);

    // ── Stage 4: Concatenate ──────────────────────────────────────────────────
    console.log("[process-reel] Stage 4: Concatenating 7s montage + 1s end card");
    await runFfmpeg([
      "-i", rawPath,
      "-i", endCardVideoPath,
      "-filter_complex",
      "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[vout][aout]",
      "-map", "[vout]",
      "-map", "[aout]",
      "-c:v", "libx264",
      "-c:a", "aac",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-y",
      outputPath,
    ]);

    // ── Stage 5: Upload ───────────────────────────────────────────────────────
    await writeStatus(jobId, { status: "uploading" });
    console.log("[process-reel] Stage 5: Uploading final video to Supabase");

    const supabase = getSupabase();
    const finalBuffer = await readFile(outputPath);
    const fileName = `${jobId}.mp4`;

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(fileName, finalBuffer, {
        contentType: "video/mp4",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Supabase video upload failed: ${uploadError.message}`);
    }

    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(fileName);
    console.log(`[process-reel] Job ${jobId} complete. Final URL: ${urlData.publicUrl}`);

    await writeStatus(jobId, { status: "complete", url: urlData.publicUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[process-reel] Job ${jobId} FAILED:`, message);

    // Best-effort: write failed status so the polling client gets a real answer
    await writeStatus(jobId, { status: "failed", error: message }).catch((e) => {
      console.error(`[process-reel] Could not write failed status for job ${jobId}:`, e);
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  return { statusCode: 200 };
};

export { handler };
