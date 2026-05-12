import { NextRequest, NextResponse } from "next/server";
import { createVideoTask, getTask, extractVideoUrl } from "@/lib/kie";
import { CROSS_DISCOVERY_PROMPT } from "@/lib/cross-prompt";

// POST /api/generate-video
// Submits a new Seedance 2.0 Fast generation task.
// Returns: { taskId: string }
export async function POST() {
  try {
    const taskId = await createVideoTask(CROSS_DISCOVERY_PROMPT);
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
// Returns: { state, videoUrl? }
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
