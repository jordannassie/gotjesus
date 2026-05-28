/**
 * POST /api/batch-plan
 *
 * Uses OpenAI to generate exactly 8 video campaign concepts for a brand.
 * Returns structured JSON ready for Seedance 2.0 generation.
 *
 * This route ONLY generates concepts. It does not:
 *   - Call Kie.ai or Seedance
 *   - Save anything to Supabase
 *   - Post to any social platform
 *
 * Body:
 *   workspaceKey     string    optional  default "gotjesus"
 *   brandName        string    optional  default "Got Jesus?"
 *   instruction      string   REQUIRED
 *   batchType        string    optional  default "Faith / Ministry Reels"
 *   referenceImageUrl string   optional
 *   batchSize        number    optional  default 8, max 8
 */

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BatchItem {
  title: string;
  adType: string;
  hook: string;
  promptText: string;
  caption: string;
  reason: string;
  platform: string;
  durationSeconds: number;
  aspectRatio: string;
  resolution: string;
  model: string;
}

export interface BatchPlanResponse {
  batchTitle: string;
  workspaceKey: string;
  brandName: string;
  batchType: string;
  items: BatchItem[];
}

// ─── Per-brand style guidance ─────────────────────────────────────────────────

const BRAND_GUIDANCE: Record<string, string> = {
  gotjesus:
    "This is a faith-based brand. Keep content positive, inviting, and sincere. Avoid clichés or cheesy church tropes. The visual style should feel modern, warm, and aspirational.",
  ugcfire:
    "This is a UGC ad and creator campaign brand. Use authentic creator-style content, direct-to-camera hooks, product-forward visuals, and social proof moments.",
  sellbop:
    "This is a digital product and business launch brand. Use creator/entrepreneur energy, transformation hooks, income or growth visuals, and launch urgency.",
  godvo:
    "This is a serious AI governance and authority-layer brand. Use clean, architectural, futuristic visuals. No hype. Convey weight, precision, and legitimacy.",
  "1billion":
    "This is a Gospel, discipleship, and ministry brand. Content should feel global, diverse, spiritually serious but accessible. Focus on movement, mission, and transformation.",
};

// ─── Build the OpenAI prompt ──────────────────────────────────────────────────

function buildSystemPrompt(brandName: string, workspaceKey: string, batchType: string): string {
  const guidance = BRAND_GUIDANCE[workspaceKey] ?? BRAND_GUIDANCE["gotjesus"];

  return `You are an expert short-form video concept writer specialising in social media ads and organic content.

Brand context:
- Brand name: ${brandName}
- Brand workspace: ${workspaceKey}
- Batch type: ${batchType}
- ${guidance}

Your job is to generate exactly 8 video concepts for Seedance 2.0 AI video generation.

STRICT RULES — follow these exactly:
1. Output ONLY valid JSON. No markdown, no explanation, no code fences.
2. Generate exactly 8 items in the "items" array.
3. Each video concept is 8 seconds long, 9:16 vertical format.
4. Do NOT invent new logos, slogans, shirt text, product claims, graphics, or promises.
5. Do NOT mention AI in any video concept.
6. Do NOT include end-card or outro instructions in promptText.
7. Do NOT use placeholder words like "[product]" or "[your brand]".
8. Each concept must be visually and thematically distinct from the others.
9. promptText must be Seedance-ready: include subject, action, setting, camera movement, lighting.
10. Caption must be social-ready (include relevant hashtags and a call to action).
11. Keep promptText under 300 characters.

JSON schema to return:
{
  "batchTitle": "short descriptive title for this batch campaign",
  "items": [
    {
      "title": "short concept title",
      "adType": "one of: Hook, Testimonial, Product Feature, Lifestyle, UGC, Motivational, Explainer, Transformation",
      "hook": "the first 3 seconds — what grabs attention immediately",
      "promptText": "Seedance-ready video generation prompt",
      "caption": "social post caption with hashtags",
      "reason": "1 sentence on why this concept works for this brand",
      "platform": "one of: Instagram, TikTok, YouTube Shorts, All"
    }
  ]
}`;
}

function buildUserPrompt(
  instruction: string,
  referenceImageUrl?: string,
): string {
  const imageNote = referenceImageUrl
    ? `\n\nReference image provided: ${referenceImageUrl}\nUse the visual content of this image — colours, subjects, style, setting — as the anchor for all 8 concepts. Preserve any visible brand details exactly.`
    : "";

  return `Campaign brief: ${instruction}${imageNote}

Generate exactly 8 video concepts now. Return only valid JSON matching the schema.`;
}

// ─── Item normalisation ───────────────────────────────────────────────────────

const ITEM_DEFAULTS = {
  durationSeconds: 8,
  aspectRatio: "9:16",
  resolution: "480p",
  model: "Seedance 2.0 Fast",
} as const;

function normaliseItem(raw: Partial<BatchItem>, index: number): BatchItem {
  return {
    title: raw.title ?? `Concept ${index + 1}`,
    adType: raw.adType ?? "Lifestyle",
    hook: raw.hook ?? "",
    promptText: raw.promptText ?? "",
    caption: raw.caption ?? "",
    reason: raw.reason ?? "",
    platform: raw.platform ?? "All",
    durationSeconds: ITEM_DEFAULTS.durationSeconds,
    aspectRatio: ITEM_DEFAULTS.aspectRatio,
    resolution: ITEM_DEFAULTS.resolution,
    model: ITEM_DEFAULTS.model,
  };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // 1 — Parse body
  let body: {
    workspaceKey?: string;
    brandName?: string;
    instruction?: string;
    batchType?: string;
    referenceImageUrl?: string;
    batchSize?: number;
  };

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const {
    workspaceKey = "gotjesus",
    brandName = "Got Jesus?",
    instruction,
    batchType = "Faith / Ministry Reels",
    referenceImageUrl,
    batchSize: rawBatchSize,
  } = body;

  // 2 — Validate required fields
  if (!instruction || instruction.trim().length === 0) {
    return NextResponse.json(
      { error: "instruction is required and must not be empty." },
      { status: 400 }
    );
  }

  // 3 — Clamp batchSize (max 8 for MVP)
  const batchSize = Math.min(Math.max(Number(rawBatchSize) || 8, 1), 8);

  // 4 — Check OpenAI key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY environment variable is not set." },
      { status: 500 }
    );
  }

  // 5 — Call OpenAI
  const openai = new OpenAI({ apiKey });

  const systemPrompt = buildSystemPrompt(brandName, workspaceKey, batchType);
  const userPrompt = buildUserPrompt(instruction, referenceImageUrl);

  console.log(
    `[batch-plan] Requesting ${batchSize} concepts for workspace=${workspaceKey} brand="${brandName}"`
  );

  let rawContent = "";
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.8,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    rawContent = completion.choices[0]?.message?.content ?? "";
    console.log(`[batch-plan] OpenAI responded (${rawContent.length} chars)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[batch-plan] OpenAI API error:", message);
    return NextResponse.json(
      { error: `OpenAI request failed: ${message}` },
      { status: 500 }
    );
  }

  // 6 — Parse and validate JSON
  let parsed: { batchTitle?: string; items?: Partial<BatchItem>[] };
  try {
    parsed = JSON.parse(rawContent) as typeof parsed;
  } catch {
    const preview = rawContent.slice(0, 300).replace(/\n/g, " ");
    console.error("[batch-plan] JSON parse failed. Raw preview:", preview);
    return NextResponse.json(
      {
        error: "OpenAI returned invalid JSON.",
        rawPreview: preview,
      },
      { status: 500 }
    );
  }

  if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
    return NextResponse.json(
      { error: "OpenAI response did not contain a valid items array." },
      { status: 500 }
    );
  }

  // 7 — Normalise items: apply defaults, trim to requested batchSize
  const items: BatchItem[] = parsed.items
    .slice(0, batchSize)
    .map((item, i) => normaliseItem(item, i));

  // Pad to batchSize if OpenAI returned fewer than requested
  while (items.length < batchSize) {
    items.push(normaliseItem({}, items.length));
  }

  // 8 — Build and return final response
  const response: BatchPlanResponse = {
    batchTitle: parsed.batchTitle ?? `${brandName} Batch Campaign`,
    workspaceKey,
    brandName,
    batchType,
    items,
  };

  console.log(
    `[batch-plan] Returning ${items.length} concepts for "${response.batchTitle}"`
  );

  return NextResponse.json(response);
}
