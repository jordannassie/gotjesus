import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { writeJobStatus, readJobStatus } from "@/lib/supabase-storage";

// POST /api/finalize-video
// Body: { rawVideoUrl: string }
// Validates env vars, writes an initial "pending" status to Supabase, invokes
// the Netlify Background Function, and returns { jobId } for client polling.
export async function POST(req: NextRequest) {
  let rawVideoUrl: string;
  try {
    const body = (await req.json()) as { rawVideoUrl?: string };
    rawVideoUrl = body.rawVideoUrl ?? "";
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!rawVideoUrl) {
    return NextResponse.json({ error: "rawVideoUrl is required" }, { status: 400 });
  }

  // Validate Supabase config before doing anything so the error is immediately clear
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      {
        error:
          "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY " +
          "in your environment variables before using final reel processing.",
      },
      { status: 500 }
    );
  }

  // Validate background function URL
  const siteUrl = process.env.DEPLOY_PRIME_URL || process.env.URL || "";
  if (!siteUrl) {
    return NextResponse.json(
      {
        error:
          "DEPLOY_PRIME_URL / URL env var is not set. " +
          "Run via `netlify dev` locally or deploy to Netlify to enable final reel processing.",
      },
      { status: 500 }
    );
  }

  const jobId = randomUUID();
  console.log(`[finalize-video] Creating job ${jobId}`);

  // Write initial "pending" status BEFORE invoking the background function.
  // If this write fails, the client would receive a jobId it can never poll —
  // so we return an error here instead.
  try {
    await writeJobStatus(jobId, { status: "pending" });
    console.log(`[finalize-video] Initial status written for job ${jobId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[finalize-video] Failed to write initial status for job ${jobId}:`, message);
    return NextResponse.json(
      {
        error:
          `Failed to initialise job in Supabase Storage: ${message}. ` +
          "Check that the bucket exists and has correct permissions.",
      },
      { status: 500 }
    );
  }

  // Invoke the background function — it returns 202 immediately and processes async
  const bgUrl = `${siteUrl}/.netlify/functions/process-reel-background`;
  console.log(`[finalize-video] Invoking background function: ${bgUrl}`);

  try {
    const bgRes = await fetch(bgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, rawVideoUrl }),
    });

    if (!bgRes.ok && bgRes.status !== 202) {
      throw new Error(`Background function responded with HTTP ${bgRes.status}`);
    }

    console.log(`[finalize-video] Job ${jobId} accepted by background function (HTTP ${bgRes.status})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[finalize-video] Background function invoke failed for job ${jobId}:`, message);
    // Write failed status so any pending poll gets a real answer
    await writeJobStatus(jobId, { status: "failed", error: `Background function error: ${message}` }).catch(() => {});
    return NextResponse.json({ error: `Could not start processing: ${message}` }, { status: 500 });
  }

  return NextResponse.json({ jobId });
}

// GET /api/finalize-video?jobId=...
// Reads current job status from Supabase Storage.
// Returns { status: "pending" } instead of 404 when the file hasn't appeared
// yet — this gives the background function a grace period to start and prevents
// the client from treating a transient startup delay as a fatal error.
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");

  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  try {
    const status = await readJobStatus(jobId);

    if (!status) {
      // Job status file not found — could be a startup lag (background function
      // hasn't written yet) or a missing/misconfigured bucket.
      // Return a safe "pending" response so the client keeps polling rather than
      // immediately failing with "Job not found".
      console.log(`[finalize-video] GET job ${jobId}: status file not found yet — returning pending`);
      return NextResponse.json({ status: "pending", updatedAt: Date.now() });
    }

    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[finalize-video] GET error for job ${jobId}:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
