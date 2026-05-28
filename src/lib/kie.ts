/**
 * Kie.ai API client — server-side only. Never import this in client components.
 * Docs: https://docs.kie.ai/market/bytedance/seedance-2-fast
 *       https://docs.kie.ai/market/common/get-task-detail
 */

const KIE_BASE_URL = "https://api.kie.ai";

function getApiKey(): string {
  const key = process.env.KIE_API_KEY;
  if (!key) {
    throw new Error(
      "KIE_API_KEY environment variable is not set. Add it to .env.local or your Netlify environment variables."
    );
  }
  return key;
}

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    "Content-Type": "application/json",
  };
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type KieTaskState =
  | "waiting"
  | "queuing"
  | "generating"
  | "success"
  | "fail";

export interface KieCreateTaskResponse {
  code: number;
  msg: string;
  data: {
    taskId: string;
  };
}

export interface KieTaskDetail {
  taskId: string;
  model: string;
  state: KieTaskState;
  param: string;
  resultJson: string | null;
  failCode: string;
  failMsg: string;
  costTime: number | null;
  completeTime: number | null;
  createTime: number;
  updateTime: number;
  creditsConsumed: number | null;
}

export interface KieGetTaskResponse {
  code: number;
  msg: string;
  data: KieTaskDetail;
}

export interface KieResultJson {
  resultUrls: string[];
}

// ─── API Calls ────────────────────────────────────────────────────────────────

/**
 * Submit a Seedance 2.0 Fast text-to-video generation task.
 * Returns the taskId to poll with getTask().
 *
 * Passes GOT_JESUS_ENDCARD_SUPABASE_URL as reference_image_urls so Seedance
 * can see the branded end card while generating. The prompt's ending suffix
 * then instructs it to use that reference image for the final branded moment.
 *
 * NOTE: last_frame_url is NOT used — Seedance 2.0 Fast rejects it without a
 * paired first_frame_url (422 "Not supporting only transmitting the last frame").
 */
export async function createVideoTask(prompt: string): Promise<string> {
  // Import here to avoid circular deps — kie.ts is a lib, brand-settings is also a lib
  const { getActiveEndCardUrl } = await import("@/lib/brand-settings");
  const endCardUrl = await getActiveEndCardUrl();

  const resolution = process.env.KIE_VIDEO_RESOLUTION || "480p";
  console.log(`[kie] locked aspect_ratio payload = "9:16"`);
  console.log(
    `[kie] full compact input summary = model=bytedance/seedance-2-fast ` +
    `duration=8 resolution=${resolution} aspect_ratio=9:16 ` +
    `reference_image_count=${endCardUrl ? 1 : 0}`
  );

  const response = await fetch(`${KIE_BASE_URL}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      model: "bytedance/seedance-2-fast",
      input: {
        prompt,
        aspect_ratio: "9:16", // must be the string format — Kie rejects numeric floats
        resolution,
        duration: 8,
        generate_audio: true,
        ...(endCardUrl ? { reference_image_urls: [endCardUrl] } : {}),
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Kie.ai createTask HTTP ${response.status}: ${text}`
    );
  }

  const json = (await response.json()) as KieCreateTaskResponse;

  if (json.code !== 200) {
    throw new Error(
      `Kie.ai createTask error code ${json.code}: ${json.msg}`
    );
  }

  return json.data.taskId;
}

/**
 * Fetch the current state of a task.
 * Poll this until state === "success" or state === "fail".
 */
export async function getTask(taskId: string): Promise<KieTaskDetail> {
  const url = new URL(`${KIE_BASE_URL}/api/v1/jobs/recordInfo`);
  url.searchParams.set("taskId", taskId);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: authHeaders(),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Kie.ai getTask HTTP ${response.status}: ${text}`
    );
  }

  const json = (await response.json()) as KieGetTaskResponse;

  if (json.code !== 200) {
    throw new Error(
      `Kie.ai getTask error code ${json.code}: ${json.msg}`
    );
  }

  return json.data;
}

/**
 * Extract the first video URL from a successful task's resultJson string.
 */
export function extractVideoUrl(task: KieTaskDetail): string | null {
  if (task.state !== "success" || !task.resultJson) return null;
  try {
    const parsed = JSON.parse(task.resultJson) as KieResultJson;
    return parsed.resultUrls?.[0] ?? null;
  } catch {
    return null;
  }
}

// ─── Image validation ─────────────────────────────────────────────────────────

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

    // PNG — IHDR chunk starts at byte 8; width at 16–19, height at 20–23 (big-endian)
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
 */
async function filterReferenceImages(urls: string[]): Promise<string[]> {
  const results = await Promise.all(
    urls.map(async (url) => {
      const ratio = await getImageRatio(url);
      if (ratio !== null && (ratio < KIE_IMG_MIN || ratio > KIE_IMG_MAX)) {
        console.warn(
          `[kie] Reference image skipped — ratio ${ratio.toFixed(2)} outside Kie range ` +
          `[${KIE_IMG_MIN}, ${KIE_IMG_MAX}]: ${url}`
        );
        return null;
      }
      return url;
    })
  );
  return results.filter((u): u is string => u !== null);
}

/**
 * Submit a Seedance 2.0 Fast video generation task using a specific prompt and
 * explicit reference image URLs.
 *
 * Unlike createVideoTask() this does NOT automatically load the end-card URL —
 * the caller is responsible for passing all reference images it wants included.
 * Images that fall outside Kie's accepted aspect-ratio range are silently filtered.
 *
 * Returns the taskId to poll with getTask().
 */
export async function createVideoTaskWithImages(
  prompt: string,
  referenceImageUrls: string[],
  resolution: string,
  duration: number
): Promise<string> {
  const apiKey = process.env.KIE_API_KEY;
  if (!apiKey) throw new Error("KIE_API_KEY is not set.");

  const safeRefs = await filterReferenceImages(referenceImageUrls);

  console.log(`[kie] createVideoTaskWithImages duration=${duration} resolution=${resolution} ` +
    `aspect_ratio=9:16 reference_image_count=${safeRefs.length}`);

  const response = await fetch(`${KIE_BASE_URL}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      model: "bytedance/seedance-2-fast",
      input: {
        prompt,
        aspect_ratio: "9:16",
        resolution,
        duration,
        generate_audio: true,
        ...(safeRefs.length > 0 ? { reference_image_urls: safeRefs } : {}),
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kie.ai createTask HTTP ${response.status}: ${text}`);
  }

  const json = (await response.json()) as KieCreateTaskResponse;
  if (json.code !== 200) {
    throw new Error(`Kie.ai createTask error code ${json.code}: ${json.msg}`);
  }

  const taskId = json.data?.taskId;
  if (!taskId) throw new Error("Kie.ai: no taskId returned");
  return taskId;
}
