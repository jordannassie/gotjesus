import { NextRequest, NextResponse } from "next/server";
import { createVideoTask, getTask, extractVideoUrl } from "@/lib/kie";
import {
  CROSS_DISCOVERY_PROMPT,
  CROSS_DISCOVERY_PROMPT_NATIVE_ENDING_SUFFIX,
} from "@/lib/cross-prompt";

// POST /api/generate-video
// Active mode: Kie-native branded ending.
//   - Full 8-second generation in one step.
//   - last_frame_url = GOT_JESUS_ENDCARD_SUPABASE_URL so Seedance ends on the
//     official Got Jesus branded image.
//   - The FFmpeg/Supabase finalization pipeline is preserved in the codebase
//     (src/app/api/finalize-video, netlify/functions/process-reel-background.ts)
//     but is NOT invoked by the active Generate Video flow.
//
// Returns: { taskId: string }
export async function POST() {
  try {
    const lastFrameUrl = process.env.GOT_JESUS_ENDCARD_SUPABASE_URL;
    const prompt =
      CROSS_DISCOVERY_PROMPT + CROSS_DISCOVERY_PROMPT_NATIVE_ENDING_SUFFIX;

    console.log("[generate-video] mode=kie-native-branded-ending (8 sec)");
    if (lastFrameUrl) {
      console.log("[generate-video] last_frame_url:", lastFrameUrl);
    } else {
      console.warn(
        "[generate-video] GOT_JESUS_ENDCARD_SUPABASE_URL is not set — " +
          "video will be generated without a branded last frame."
      );
    }

    const taskId = await createVideoTask(prompt, lastFrameUrl);
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
