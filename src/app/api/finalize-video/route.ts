import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  writeJobStatus,
  readJobStatus,
} from "@/lib/supabase-storage";

// POST /api/finalize-video
// Body: { rawVideoUrl: string }
// Creates a finalization job, invokes the Netlify Background Function, returns { jobId }.
export async function POST(req: NextRequest) {
  let rawVideoUrl: string;

  try {
    const body = (await req.json()) as { rawVideoUrl?: string };
    rawVideoUrl = body.rawVideoUrl ?? "";
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  if (!rawVideoUrl) {
    return NextResponse.json(
      { error: "rawVideoUrl is required" },
      { status: 400 }
    );
  }

  const jobId = randomUUID();

  try {
    // Write initial status to Supabase so the polling endpoint finds it immediately
    await writeJobStatus(jobId, { status: "pending" });

    // Determine background function URL
    const siteUrl =
      process.env.DEPLOY_PRIME_URL || process.env.URL || "";

    if (!siteUrl) {
      throw new Error(
        "DEPLOY_PRIME_URL / URL env var is not set. " +
          "Run via `netlify dev` locally, or deploy to Netlify to test finalization."
      );
    }

    const bgUrl = `${siteUrl}/.netlify/functions/process-reel-background`;
    console.log("[finalize-video] Invoking background function:", bgUrl);

    // Background functions return 202 immediately — do not await the video result
    const bgRes = await fetch(bgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, rawVideoUrl }),
    });

    // 202 = accepted by background function; other 2xx also acceptable
    if (!bgRes.ok && bgRes.status !== 202) {
      throw new Error(
        `Background function invoke failed: HTTP ${bgRes.status}`
      );
    }

    console.log(`[finalize-video] Job ${jobId} queued (bg status: ${bgRes.status})`);
    return NextResponse.json({ jobId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[finalize-video] POST error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET /api/finalize-video?jobId=...
// Reads current job status from Supabase.
// Returns: { status, url?, error?, updatedAt }
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");

  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  try {
    const status = await readJobStatus(jobId);
    if (!status) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[finalize-video] GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
