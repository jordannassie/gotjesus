import { NextRequest, NextResponse } from "next/server";
import { createVideoTask, getTask, extractVideoUrl } from "@/lib/kie";
import {
  CROSS_DISCOVERY_PROMPT,
  CROSS_DISCOVERY_PROMPT_NATIVE_ENDING_SUFFIX,
} from "@/lib/cross-prompt";

// POST /api/generate-video
// Submits an 8-second Seedance 2.0 Fast job.
// GOT_JESUS_ENDCARD_SUPABASE_URL is passed as reference_image_urls so Seedance
// can see the branded end card. The prompt suffix instructs it to use that
// reference for the final branded ending moment.
// Returns: { taskId: string }
export async function POST() {
  try {
    const prompt =
      CROSS_DISCOVERY_PROMPT + CROSS_DISCOVERY_PROMPT_NATIVE_ENDING_SUFFIX;

    const endCardUrl = process.env.GOT_JESUS_ENDCARD_SUPABASE_URL;
    console.log("[generate-video] Submitting 8-sec Seedance job");
    if (endCardUrl) {
      console.log("[generate-video] reference_image_urls:", endCardUrl);
    } else {
      console.warn("[generate-video] GOT_JESUS_ENDCARD_SUPABASE_URL not set — no reference image");
    }
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
