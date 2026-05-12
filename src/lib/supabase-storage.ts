/**
 * Supabase Storage helpers — server-side only.
 * Used by the finalize-video API route to read/write job status and upload final videos.
 *
 * The bucket must have Public access enabled in Supabase for getPublicUrl() to work.
 * Bucket name is configured via SUPABASE_VIDEO_BUCKET (default: "gotjesus-videos").
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

export const BUCKET =
  process.env.SUPABASE_VIDEO_BUCKET || "gotjesus-videos";

function getClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment variables."
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
    console.error(`[supabase] writeJobStatus(${jobId}):`, error.message);
  }
}

export async function readJobStatus(jobId: string): Promise<JobStatus | null> {
  const supabase = getClient();

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
    throw new Error(`Supabase upload failed: ${error.message}`);
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
  return data.publicUrl;
}
