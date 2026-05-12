import { NextRequest, NextResponse } from "next/server";
import { createVideoTask, getTask, extractVideoUrl } from "@/lib/kie";
import {
  CROSS_DISCOVERY_PROMPT,
  CROSS_DISCOVERY_PROMPT_NATIVE_ENDING_SUFFIX,
} from "@/lib/cross-prompt";

// POST /api/generate-video
// Submits a new Seedance 2.0 Fast generation task.
//
// When KIE_NATIVE_ENDING_TEST=true:
//   - appends the native-ending suffix to the prompt
//   - passes GOT_JESUS_ENDCARD_SUPABASE_URL as last_frame_url
//   - Kie will generate an 8-second video ending on the branded end card
// When KIE_NATIVE_ENDING_TEST is not set (default):
//   - uses the base prompt only, 7-second duration
//   - FFmpeg finalization pipeline handles the end card
//
// Returns: { taskId: string, nativeEndingTest: boolean }
export async function POST() {
  try {
    const isNativeEndingTest = process.env.KIE_NATIVE_ENDING_TEST === "true";
    const lastFrameUrl = isNativeEndingTest
      ? process.env.GOT_JESUS_ENDCARD_SUPABASE_URL
      : undefined;

    const prompt = isNativeEndingTest
      ? CROSS_DISCOVERY_PROMPT + CROSS_DISCOVERY_PROMPT_NATIVE_ENDING_SUFFIX
      : CROSS_DISCOVERY_PROMPT;

    console.log(
      `[generate-video] mode=${isNativeEndingTest ? "native-ending-test" : "ffmpeg-pipeline"}`,
      lastFrameUrl ? `lastFrameUrl=${lastFrameUrl}` : ""
    );

    const taskId = await createVideoTask(prompt, lastFrameUrl);
    console.log("[generate-video] Task created:", taskId);

    return NextResponse.json({ taskId, nativeEndingTest: isNativeEndingTest });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[generate-video] POST error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET /api/generate-video?taskId=...
// Polls the current state of a generation task.
// Returns: { state, videoUrl?, nativeEndingTest? }
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
