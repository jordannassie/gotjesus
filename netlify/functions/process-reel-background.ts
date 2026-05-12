/**
 * Netlify Background Function — process-reel-background
 *
 * Invoked by POST /api/finalize-video. Returns 202 immediately and runs
 * asynchronously for up to 15 minutes (Netlify background function limit).
 *
 * Flow:
 *   1. Download raw Kie video to /tmp
 *   2. Download official Got Jesus end card from deployment URL
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
import { readFile, mkdir, rm, chmod, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

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
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function writeStatus(
  jobId: string,
  data: Omit<JobStatus, "updatedAt">
): Promise<void> {
  const supabase = getSupabase();
  const payload: JobStatus = { ...data, updatedAt: Date.now() };

  await supabase.storage
    .from(process.env.SUPABASE_VIDEO_BUCKET || "gotjesus-videos")
    .upload(`status/${jobId}.json`, Buffer.from(JSON.stringify(payload)), {
      contentType: "application/json",
      upsert: true,
    });
}

// ─── Download helper ──────────────────────────────────────────────────────────

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed [${url}]: HTTP ${res.status}`);
  }
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

// ─── FFmpeg helper ────────────────────────────────────────────────────────────

async function runFfmpeg(args: string[]): Promise<void> {
  if (!ffmpegStatic) throw new Error("ffmpeg-static binary not found.");

  const { stderr } = await execFileAsync(ffmpegStatic, args, {
    maxBuffer: 100 * 1024 * 1024, // 100 MB — FFmpeg logs to stderr
  });

  if (stderr) {
    console.log("[ffmpeg]", stderr.slice(-2000)); // Log last 2kb of stderr
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

  const bucket = process.env.SUPABASE_VIDEO_BUCKET || "gotjesus-videos";
  const tmpDir = join(tmpdir(), `reel-${randomUUID()}`);
  const rawPath = join(tmpDir, "raw.mp4");
  const endCardPath = join(tmpDir, "endcard.png");
  const endCardVideoPath = join(tmpDir, "endcard.mp4");
  const outputPath = join(tmpDir, "final.mp4");

  try {
    await mkdir(tmpDir, { recursive: true });

    // Ensure ffmpeg binary is executable on Lambda
    if (ffmpegStatic) {
      await chmod(ffmpegStatic, 0o755).catch(() => {});
    }

    await writeStatus(jobId, { status: "processing" });

    // Download raw video from Kie.ai
    console.log("[process-reel] Downloading raw video…");
    await downloadToFile(rawVideoUrl, rawPath);

    // Download official end card from this deployment
    const siteUrl =
      process.env.DEPLOY_PRIME_URL ||
      process.env.URL ||
      "http://localhost:8888";
    const endCardUrl = `${siteUrl}/gotjesus-endcard.png`;
    console.log("[process-reel] Downloading end card from", endCardUrl);
    await downloadToFile(endCardUrl, endCardPath);

    await writeStatus(jobId, { status: "appending_endcard" });

    // Determine output dimensions from resolution config
    const resolution = process.env.KIE_VIDEO_RESOLUTION || "720p";
    const width = resolution === "480p" ? 480 : 720;
    const height = resolution === "480p" ? 854 : 1280;
    const scaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;

    // Step 1: Create 1-second silent end card video
    console.log("[process-reel] Creating end card segment…");
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

    // Step 2: Concatenate raw video + end card into final 8-second MP4
    console.log("[process-reel] Concatenating video + end card…");
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

    await writeStatus(jobId, { status: "uploading" });

    // Upload final MP4 to Supabase Storage
    console.log("[process-reel] Uploading final video to Supabase…");
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
      throw new Error(`Supabase upload error: ${uploadError.message}`);
    }

    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(fileName);

    console.log("[process-reel] Final URL:", urlData.publicUrl);
    await writeStatus(jobId, { status: "complete", url: urlData.publicUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[process-reel] Error:", message);
    await writeStatus(jobId, { status: "failed", error: message }).catch(
      () => {}
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  return { statusCode: 200 };
};

export { handler };
