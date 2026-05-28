/**
 * POST /api/batch-plan
 *
 * Uses OpenAI to generate exactly 8 platform-neutral video campaign concepts.
 * Returns structured JSON ready for Seedance 2.0 generation.
 *
 * This route ONLY generates concepts. It does not:
 *   - Call Kie.ai or Seedance
 *   - Save anything to Supabase
 *   - Post to any social platform
 *
 * Body:
 *   workspaceKey      string    optional  default "gotjesus"
 *   brandName         string    optional  default "Got Jesus?"
 *   instruction       string   REQUIRED
 *   batchType         string    optional  default "General Product Ads"
 *   referenceImages   Array<{ tag, name?, url }>  optional  tagged reference images
 *   referenceImageUrl string    optional  legacy single-image fallback
 *   batchSize         number    optional  default 8, max 8
 */

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReferenceImage {
  tag: string;
  name?: string;
  url: string;
}

export interface BatchItem {
  title: string;
  adType: string;
  hook: string;
  promptText: string;
  caption: string;
  reason: string;
  platform: string;      // always "All Platforms" — kept for backwards compat
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

const NEUTRAL_BRAND_GUIDANCE =
  "Match the tone, style, and content to the brand name, batch type, and campaign brief provided. Do not invent product claims, slogans, or brand promises not found in the brief or reference images.";

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
4. Do NOT invent logos, slogans, shirt text, product claims, pricing, or brand promises not present in the brief or reference images.
5. Do NOT add religious, faith, or spiritual language unless the brand context or instruction specifically calls for it.
6. Do NOT mention AI in any video concept.
7. Do NOT include end-card or outro instructions in promptText.
8. Do NOT use placeholder words like "[product]" or "[your brand]".
9. Each concept must be visually and thematically distinct — vary style, tone, setting, and approach.
10. promptText must be Seedance-ready: subject, action, setting, camera movement, lighting. Under 300 characters.
11. Caption must be social-ready with relevant hashtags and a call to action.
12. PLATFORM RULE: Do NOT write concepts for a specific platform. Every concept must work for Instagram Reels, TikTok, YouTube Shorts, and Facebook Reels equally. Do not mention platform names in promptText.
13. VIDEO STYLE VARIETY: Vary the style across the 8 concepts — use: UGC-style, lifestyle scene, product demo, testimonial-style, problem-solution, cinematic brand shot, hook-based social clip, unboxing/reveal.
14. IMAGE TAG RULE: If reference images are provided with tags like @product1 or @logo, use those exact tags in promptText when referencing the image. Do not invent visual details that contradict the tagged image.

JSON schema to return:
{
  "batchTitle": "short descriptive title for this batch campaign",
  "items": [
    {
      "title": "short concept title",
      "adType": "one of: Hook, Testimonial, Product Demo, Lifestyle, UGC, Cinematic, Unboxing, Problem-Solution",
      "hook": "the first 3 seconds — what grabs attention immediately",
      "promptText": "Seedance-ready video generation prompt. Reference tagged images by their exact tag.",
      "caption": "social post caption with hashtags",
      "reason": "1 sentence on why this concept works for this brand"
    }
  ]
}`;
}

function buildUserPrompt(
  instruction: string,
  referenceImages: ReferenceImage[],
  legacyImageUrl?: string,
): string {
  let imageSection = "";

  if (referenceImages.length > 0) {
    const imageList = referenceImages
      .map((img) => `  - ${img.tag}: ${img.url}${img.name ? ` (${img.name})` : ""}`)
      .join("\n");
    imageSection = `

Reference images (tagged):
${imageList}

Use these tags exactly when writing Seedance prompts:
- Reference each image by its tag (e.g. @product1, @logo) when relevant.
- Treat @product images as the exact product/design reference — preserve all visible details.
- Do not invent product details, text, or design elements not visible in the image.
- You may use multiple tags in one prompt if it makes sense (e.g. "@model1 holding @product1").`;
  } else if (legacyImageUrl) {
    imageSection = `

Reference image: ${legacyImageUrl}
Use the visual content of this image as the anchor for all 8 concepts. Preserve any visible brand details exactly.`;
  }

  return `Campaign brief: ${instruction}${imageSection}

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
    title:           raw.title    ?? `Concept ${index + 1}`,
    adType:          raw.adType   ?? "Lifestyle",
    hook:            raw.hook     ?? "",
    promptText:      raw.promptText ?? "",
    caption:         raw.caption  ?? "",
    reason:          raw.reason   ?? "",
    platform:        "All Platforms",   // always neutral — not exposed in UI
    durationSeconds: ITEM_DEFAULTS.durationSeconds,
    aspectRatio:     ITEM_DEFAULTS.aspectRatio,
    resolution:      ITEM_DEFAULTS.resolution,
    model:           ITEM_DEFAULTS.model,
  };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: {
    workspaceKey?: string;
    brandName?: string;
    instruction?: string;
    batchType?: string;
    referenceImages?: ReferenceImage[];
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
    referenceImages = [],
    referenceImageUrl,
    batchSize: rawBatchSize,
  } = body;

  if (!instruction || instruction.trim().length === 0) {
    return NextResponse.json(
      { error: "instruction is required and must not be empty." },
      { status: 400 }
    );
  }

  const batchSize = Math.min(Math.max(Number(rawBatchSize) || 8, 1), 8);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY environment variable is not set." },
      { status: 500 }
    );
  }

  const openai = new OpenAI({ apiKey });

  const systemPrompt = buildSystemPrompt(brandName, workspaceKey, batchType);
  const userPrompt = buildUserPrompt(instruction, referenceImages, referenceImageUrl);

  console.log(
    `[batch-plan] Requesting ${batchSize} concepts for workspace=${workspaceKey} ` +
    `brand="${brandName}" refImages=${referenceImages.length}`
  );

  let rawContent = "";
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.8,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
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

  let parsed: { batchTitle?: string; items?: Partial<BatchItem>[] };
  try {
    parsed = JSON.parse(rawContent) as typeof parsed;
  } catch {
    const preview = rawContent.slice(0, 300).replace(/\n/g, " ");
    console.error("[batch-plan] JSON parse failed. Raw preview:", preview);
    return NextResponse.json(
      { error: "OpenAI returned invalid JSON.", rawPreview: preview },
      { status: 500 }
    );
  }

  if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
    return NextResponse.json(
      { error: "OpenAI response did not contain a valid items array." },
      { status: 500 }
    );
  }

  const items: BatchItem[] = parsed.items
    .slice(0, batchSize)
    .map((item, i) => normaliseItem(item, i));

  while (items.length < batchSize) {
    items.push(normaliseItem({}, items.length));
  }

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
