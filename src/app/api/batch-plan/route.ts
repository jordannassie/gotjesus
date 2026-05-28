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

// Fallback is used for any workspace not listed here — keeps output neutral.
const NEUTRAL_BRAND_GUIDANCE =
  "Match the tone, style, and content to the brand name, batch type, and campaign brief provided. Do not invent product claims, slogans, or brand promises not found in the brief or reference image.";

const BRAND_GUIDANCE: Record<string, string> = {
  gotjesus:
    "Faith-based apparel and lifestyle brand. Keep content warm, modern, and visually compelling. Do not force religious themes unless the instruction asks for them. Avoid clichés.",
  ugcfire:
    "UGC ad and creator campaign brand. Use authentic creator-style content, direct-to-camera hooks, product-forward visuals, and social proof moments.",
  sellbop:
    "Digital product and business launch brand. Use creator/entrepreneur energy, transformation hooks, growth visuals, and launch urgency.",
  godvo:
    "AI governance and authority-layer brand. Use clean, architectural, futuristic visuals. No hype. Convey weight, precision, and legitimacy.",
  "1billion":
    "Gospel, discipleship, and ministry brand. Content should feel global, diverse, and spiritually accessible. Focus on movement, mission, and transformation.",
};

// ─── Build the OpenAI prompt ──────────────────────────────────────────────────

function buildSystemPrompt(brandName: string, workspaceKey: string, batchType: string): string {
  const guidance = BRAND_GUIDANCE[workspaceKey] ?? NEUTRAL_BRAND_GUIDANCE;

  return `You are an expert short-form video concept writer specialising in social media ads and organic content for any type of brand, product, or service.

Brand context:
- Brand name: ${brandName}
- Batch type: ${batchType}
- Brand style guidance: ${guidance}

Your job is to generate exactly 8 video concepts for Seedance 2.0 AI video generation.

STRICT RULES — follow these exactly:
1. Output ONLY valid JSON. No markdown, no explanation, no code fences.
2. Generate exactly 8 items in the "items" array.
3. Each video concept is 8 seconds long, 9:16 vertical format.
4. Do NOT invent logos, slogans, shirt text, product claims, pricing, or brand promises not present in the brief or reference image.
5. Do NOT add religious, faith, or spiritual language unless the brand context or instruction specifically calls for it.
6. Do NOT mention AI in any video concept.
7. Do NOT include end-card or outro instructions in promptText.
8. Do NOT use placeholder words like "[product]" or "[your brand]".
9. Each concept must be visually and thematically distinct from the others — vary format, tone, and angle.
10. promptText must be Seedance-ready: describe subject, action, setting, camera movement, and lighting concisely.
11. Caption must be social-ready with relevant hashtags and a call to action.
12. Keep promptText under 300 characters.
13. For a General Product Ads batch type, create a diverse mix:
    UGC-style ad, product demo, lifestyle scene, testimonial-style, problem-solution, cinematic brand shot, hook-based social clip, wildcard viral concept.

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
    batchType = "General Product Ads",
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
