import { NextRequest, NextResponse } from "next/server";
import { createVideoTask, getTask, extractVideoUrl } from "@/lib/kie";
import {
  CROSS_DISCOVERY_PROMPT,
  CROSS_DISCOVERY_PROMPT_NATIVE_ENDING_SUFFIX,
  PROMPT_VERSION,
} from "@/lib/cross-prompt";
import { getActiveEndCardUrl } from "@/lib/brand-settings";

const KIE_BASE_URL = "https://api.kie.ai";

// Output aspect ratio is LOCKED to "9:16" for all Got Jesus reels.
// Kie.ai expects the colon-format string — do NOT convert to a float.
const LOCKED_ASPECT_RATIO = "9:16";

// Kie.ai validates every reference image's own pixel dimensions.
// Any image whose width/height ratio is outside this range causes a 422 error.
const KIE_IMG_MIN = 0.4;
const KIE_IMG_MAX = 2.5;

/**
 * Reads the first 64 KB of an image URL and returns its pixel aspect ratio
 * (width / height). Returns null if the format is unrecognised or a network
 * error occurs — callers treat null as "allow through".
 *
 * Supports PNG, JPEG, and WebP without any external dependencies.
 */
async function getImageRatio(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { headers: { Range: "bytes=0-65535" } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());

    // PNG — IHDR chunk starts at byte 8; width at 16-19, height at 20-23 (big-endian)
    if (
      buf.length >= 24 &&
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
    ) {
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      return w > 0 && h > 0 ? w / h : null;
    }

    // JPEG — scan for SOF marker (FF C0–C3, C5–C7, C9–CB, CD–CF)
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 3 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if (
          (m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) ||
          (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)
        ) {
          if (i + 8 < buf.length) {
            const h = buf.readUInt16BE(i + 5);
            const w = buf.readUInt16BE(i + 7);
            return w > 0 && h > 0 ? w / h : null;
          }
        }
        if (i + 3 >= buf.length) break;
        const len = buf.readUInt16BE(i + 2);
        if (len < 2) break;
        i += 2 + len;
      }
    }

    // WebP — VP8 (lossy) chunk
    if (
      buf.length >= 30 &&
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // RIFF
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50  // WEBP
    ) {
      if (buf[12] === 0x56 && buf[13] === 0x50 && buf[14] === 0x38 && buf[15] === 0x20) {
        const w = (buf.readUInt16LE(26) & 0x3fff) + 1;
        const h = (buf.readUInt16LE(28) & 0x3fff) + 1;
        return w > 0 && h > 0 ? w / h : null;
      }
    }

    return null; // unknown format — allow through
  } catch {
    return null;
  }
}

/**
 * Filters a list of reference image URLs, silently removing any whose pixel
 * dimensions fall outside Kie.ai's accepted range [0.4, 2.5].
 * Images whose dimensions cannot be read are kept (allow-through).
 * The end-card URL is never filtered — it is always valid (9:16).
 */
async function filterReferenceImages(urls: string[]): Promise<string[]> {
  const results = await Promise.all(
    urls.map(async (url) => {
      const ratio = await getImageRatio(url);
      if (ratio !== null && (ratio < KIE_IMG_MIN || ratio > KIE_IMG_MAX)) {
        console.warn(
          `[kie] Reference image skipped — ratio ${ratio.toFixed(2)} outside Kie range [${KIE_IMG_MIN}, ${KIE_IMG_MAX}]: ${url}`
        );
        return null;
      }
      return url;
    })
  );
  return results.filter((u): u is string => u !== null);
}

async function submitKieJobWithImages(
  prompt: string,
  referenceImageUrls: string[],
  resolution: string,
  duration: number
): Promise<string> {
  // Read active end card from brand settings (DB), fall back to env var
  const endCardUrl = await getActiveEndCardUrl();

  // Filter user reference images by pixel ratio — any image outside [0.4, 2.5]
  // is silently skipped so Kie doesn't reject the whole request.
  // The end card is always included last; its ratio is always valid (9:16 = 0.5625).
  const safeRefs = await filterReferenceImages(referenceImageUrls);
  const allRefs = [...safeRefs, ...(endCardUrl ? [endCardUrl] : [])];

  const apiKey = process.env.KIE_API_KEY;
  if (!apiKey) throw new Error("KIE_API_KEY is not set.");

  // Confirm exactly what is being sent to Kie
  console.log(`[kie] locked aspect_ratio payload = "${LOCKED_ASPECT_RATIO}"`);
  console.log(
    `[kie] full compact input summary = model=bytedance/seedance-2-fast ` +
    `duration=${duration} resolution=${resolution} aspect_ratio=${LOCKED_ASPECT_RATIO} ` +
    `reference_image_count=${allRefs.length}`
  );

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
        aspect_ratio: LOCKED_ASPECT_RATIO, // must be "9:16" string — Kie rejects numeric floats
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
