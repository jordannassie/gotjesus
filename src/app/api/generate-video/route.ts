import { NextRequest, NextResponse } from "next/server";
import { createVideoTask, getTask, extractVideoUrl } from "@/lib/kie";
import {
  CROSS_DISCOVERY_PROMPT,
  CROSS_DISCOVERY_PROMPT_NATIVE_ENDING_SUFFIX,
} from "@/lib/cross-prompt";

// POST /api/generate-video
// Submits an 8-second Seedance 2.0 Fast text-to-video job.
// The branded ending is requested via prompt text — Seedance does NOT support
// last_frame_url alone (returns 422 "Not supporting only transmitting the last frame").
// Returns: { taskId: string }
export async function POST() {
  try {
    const prompt =
      CROSS_DISCOVERY_PROMPT + CROSS_DISCOVERY_PROMPT_NATIVE_ENDING_SUFFIX;

    console.log("[generate-video] Submitting 8-sec Seedance job (text-to-video)");
    const taskId = await createVideoTask(prompt);
    console.log("[generate-video] Task created:", taskId);

    return NextResponse.json({ taskId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[generate-video] POST error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET /api/generate-video?taskId=...
// Polls the current state of a generation task.
// Returns: { state, videoUrl?, failMsg?, failCode? }
export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get("taskId");

  if (!taskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }

  try {
    const task = await getTask(taskId);
    console.log("[generate-video] Poll:", taskId, "→", task.state);

    const videoUrl = extractVideoUrl(task);

    return NextResponse.json({
      state: task.state,
      videoUrl: videoUrl ?? null,
      failMsg: task.failMsg || null,
      failCode: task.failCode || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[generate-video] GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
