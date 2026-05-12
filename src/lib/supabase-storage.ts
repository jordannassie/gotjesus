/**
 * Supabase Storage helpers — server-side only.
 *
 * Job status files are stored as JSON blobs at status/<jobId>.json inside the
 * video bucket. Final MP4s are stored at <jobId>.mp4 in the same bucket.
 *
 * The bucket must have Public access enabled in Supabase for getPublicUrl() to
 * return a reachable URL. Configure the bucket name via SUPABASE_VIDEO_BUCKET
 * (default: "gotjesus-videos").
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

export const BUCKET =
  process.env.SUPABASE_VIDEO_BUCKET || "gotjesus-videos";

/**
 * Returns a validated Supabase client.
 * Throws with a descriptive message if env vars are missing.
 */
function getClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  return createClient(url, key);
}

// ─── Job status ───────────────────────────────────────────────────────────────

export type JobStatusValue =
  | "pending"
  | "processing"
  | "appending_endcard"
  | "uploading"
  | "complete"
  | "failed";

export interface JobStatus {
  status: JobStatusValue;
  url?: string;
  error?: string;
  updatedAt: number;
}

/**
 * Writes (or overwrites) the status JSON for a job.
 * Throws if the Supabase upload fails — callers must handle the error.
 */
export async function writeJobStatus(
  jobId: string,
  data: Omit<JobStatus, "updatedAt">
): Promise<void> {
  const supabase = getClient();
  const payload: JobStatus = { ...data, updatedAt: Date.now() };

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(`status/${jobId}.json`, Buffer.from(JSON.stringify(payload)), {
      contentType: "application/json",
      upsert: true,
    });

  if (error) {
    // Throw so the caller knows the write failed — silently swallowing this
    // was the root cause of "Job not found" errors seen by the client.
    throw new Error(`writeJobStatus(${jobId}) failed: ${error.message}`);
  }

  console.log(`[supabase-storage] writeJobStatus(${jobId}): status=${data.status}`);
}

/**
 * Reads the current status for a job from Supabase Storage.
 * Returns null if the file doesn't exist yet (normal during startup lag)
 * or if Supabase is unreachable.
 */
export async function readJobStatus(jobId: string): Promise<JobStatus | null> {
  let supabase: SupabaseClient;
  try {
    supabase = getClient();
  } catch {
    return null;
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(`status/${jobId}.json`);

  if (error || !data) return null;

  try {
    return JSON.parse(await data.text()) as JobStatus;
  } catch {
    return null;
  }
}

// ─── Video upload ─────────────────────────────────────────────────────────────

export async function uploadFinalVideo(
  jobId: string,
  buffer: Buffer
): Promise<string> {
  const supabase = getClient();
  const fileName = `${jobId}.mp4`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, buffer, { contentType: "video/mp4", upsert: true });

  if (error) {
    throw new Error(`Supabase video upload failed: ${error.message}`);
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
  return data.publicUrl;
}
