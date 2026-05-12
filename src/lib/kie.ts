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
 * When lastFrameUrl is provided (native-ending test mode):
 *   - duration is set to 8 seconds
 *   - last_frame_url is included so Seedance ends on the branded end card
 * When lastFrameUrl is omitted (normal FFmpeg pipeline mode):
 *   - duration is 7 seconds (1 second reserved for FFmpeg end card assembly)
 */
export async function createVideoTask(
  prompt: string,
  lastFrameUrl?: string
): Promise<string> {
  const response = await fetch(`${KIE_BASE_URL}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      model: "bytedance/seedance-2-fast",
      input: {
        prompt,
        aspect_ratio: "9:16",
        resolution: process.env.KIE_VIDEO_RESOLUTION || "480p",
        duration: lastFrameUrl ? 8 : 7,
        generate_audio: true,
        ...(lastFrameUrl ? { last_frame_url: lastFrameUrl } : {}),
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
