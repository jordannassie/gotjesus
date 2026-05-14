import { NextRequest, NextResponse } from "next/server";
import { createVideoTask, getTask, extractVideoUrl } from "@/lib/kie";
import {
  CROSS_DISCOVERY_PROMPT,
  CROSS_DISCOVERY_PROMPT_NATIVE_ENDING_SUFFIX,
  PROMPT_VERSION,
} from "@/lib/cross-prompt";

const KIE_BASE_URL = "https://api.kie.ai";

/**
 * Submits a Kie.ai job with explicit reference images.
 * Used when generating from a content slot that has its own prompt and images.
 * The end card URL is always appended so the branded ending is preserved.
 */
async function submitKieJobWithImages(
  prompt: string,
  referenceImageUrls: string[],
  resolution: string,
  duration: number
): Promise<string> {
  const endCardUrl = process.env.GOT_JESUS_ENDCARD_SUPABASE_URL;
  // Always include end card last so Seedance anchors the branded ending
  const allRefs = [...referenceImageUrls, ...(endCardUrl ? [endCardUrl] : [])];

  const apiKey = process.env.KIE_API_KEY;
  if (!apiKey) throw new Error("KIE_API_KEY is not set.");

  const response = await fetch(`${KIE_BASE_URL}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "bytedance/seedance-2-fast",
      input: {
        prompt,
        aspect_ratio: "9:16",
        resolution,
        duration,
        generate_audio: true,
        ...(allRefs.length > 0 ? { reference_image_urls: allRefs } : {}),
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kie.ai createTask HTTP ${response.status}: ${text}`);
  }

  const json = (await response.json()) as { code: number; msg: string; data?: { taskId?: string } };
  if (json.code !== 200) {
    throw new Error(`Kie.ai createTask error code ${json.code}: ${json.msg}`);
  }
  const taskId = json.data?.taskId;
  if (!taskId) throw new Error("Kie.ai: no taskId returned");
  return taskId;
}

// POST /api/generate-video
// Default: submits using canonical CROSS_DISCOVERY_PROMPT + end card reference.
// Slot override: accepts { promptOverride, referenceImageUrls, slotKey, resolution, duration }
// in the JSON body to generate from a content slot.
export async function POST(req: NextRequest) {
  try {
    // Accept optional slot-based overrides in the body
    let body: {
      promptOverride?: string;
      referenceImageUrls?: string[];
      slotKey?: string;
      resolution?: string;
      duration?: number;
    } = {};

    try {
      body = (await req.json()) as typeof body;
    } catch {
      // no body — use defaults
    }

    const {
      promptOverride,
      referenceImageUrls,
      slotKey,
      resolution: slotResolution,
      duration: slotDuration,
    } = body;

    let taskId: string;

    if (promptOverride) {
      // Slot-based generation — use slot prompt + images
      const source = slotKey ?? "slot";
      console.log(`[prompt] version=${PROMPT_VERSION} source=${source}`);
      console.log(`[generate-video] Slot generation — slotKey=${slotKey}`);

      const resolution = slotResolution ?? process.env.KIE_VIDEO_RESOLUTION ?? "480p";
      const duration = slotDuration ?? 8;
      const refs = referenceImageUrls ?? [];

      taskId = await submitKieJobWithImages(
        promptOverride + CROSS_DISCOVERY_PROMPT_NATIVE_ENDING_SUFFIX,
        refs,
        resolution,
        duration
      );
    } else {
      // Default generation — canonical prompt from cross-prompt.ts
      const prompt = CROSS_DISCOVERY_PROMPT + CROSS_DISCOVERY_PROMPT_NATIVE_ENDING_SUFFIX;
      const endCardUrl = process.env.GOT_JESUS_ENDCARD_SUPABASE_URL;
      console.log(`[prompt] version=${PROMPT_VERSION} source=manual`);
      console.log("[generate-video] Submitting 8-sec Seedance job");
      if (endCardUrl) {
        console.log("[generate-video] reference_image_urls:", endCardUrl);
      } else {
        console.warn("[generate-video] GOT_JESUS_ENDCARD_SUPABASE_URL not set — no reference image");
      }
      taskId = await createVideoTask(prompt);
    }

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
