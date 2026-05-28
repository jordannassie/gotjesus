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
  includeVoiceover: boolean;
  items: BatchItem[];
}

// ─── Batch type strategies ────────────────────────────────────────────────────
// Each entry defines the creative focus and the 8 required ad-type labels that
// GPT must use — in order. After GPT responds, adType is overwritten server-side
// with these values so UI cards always reflect the selected strategy.

interface BatchTypeStrategy {
  focus: string;           // injected into system prompt
  requiredAdTypes: readonly [string, string, string, string, string, string, string, string];
}

const BATCH_TYPE_STRATEGIES: Record<string, BatchTypeStrategy> = {
  "General Product Ads": {
    focus:
      "Create a broad, varied mix of product-focused ad styles. Use every major ad format: lifestyle, product showcase, testimonial, unboxing, problem-solution, cinematic brand shot, hook-based social ad, and one unexpected wildcard creative.",
    requiredAdTypes: [
      "Lifestyle Product Shot",
      "Product Showcase",
      "Problem / Solution",
      "Unboxing",
      "Review / Testimonial",
      "Cinematic Brand Shot",
      "Hook-Based Social Ad",
      "Wildcard Creative",
    ],
  },
  "UGC Ads": {
    focus:
      "All 8 concepts must be authentic, creator-style UGC ads. Shoot in portrait, handheld, natural-light, real-person style. No polished studio production. Concepts should feel genuinely filmed by real customers or creators. Include testimonial, unboxing, problem/solution, demo, reaction, social proof, reasons-why, and lifestyle.",
    requiredAdTypes: [
      "UGC Selfie Testimonial",
      "UGC Unboxing",
      "UGC Problem / Solution",
      "UGC Product Demo",
      "UGC Review / Reaction",
      "UGC Social Proof",
      "UGC 3 Reasons Why",
      "UGC Lifestyle Use Case",
    ],
  },
  "Product Launch": {
    focus:
      "All 8 concepts must be launch-event-style ads. Build excitement, reveal, and urgency. Treat this as a launch campaign rollout: big reveal, teaser, first look, origin story, product benefits, founder angle, launch day energy, and limited-time push.",
    requiredAdTypes: [
      "Big Reveal",
      "Coming Soon / Teaser",
      "First Look",
      "Why We Made This",
      "Launch Day Energy",
      "Product Benefits",
      "Founder / Creator Style",
      "Limited-Time Launch Push",
    ],
  },
  "Ecommerce Product Ads": {
    focus:
      "All 8 concepts must be direct-response ecommerce ads. Every concept should drive a click or purchase. Use scroll-stopping hooks, clear product demos, benefit stacks, social proof, objection-busting, and strong CTAs.",
    requiredAdTypes: [
      "Scroll-Stopping Hook",
      "Product Demo",
      "Problem / Solution",
      "Unboxing",
      "Benefit Stack",
      "Social Proof",
      "Objection Crusher",
      "Direct Response CTA",
    ],
  },
  "App / Software Promo": {
    focus:
      "All 8 concepts must promote an app, SaaS, or software product. Show the app in use, the problem it solves, speed/convenience benefits, feature highlights, user reactions, and clear download/signup CTAs. No physical product shots.",
    requiredAdTypes: [
      "App Screen Demo",
      "Problem / Workflow",
      "Feature Highlight",
      "Before / After Workflow",
      "User Reaction",
      "Speed / Convenience Demo",
      "Use Case Story",
      "CTA Download / Signup",
    ],
  },
  "Local Business Ads": {
    focus:
      "All 8 concepts must be hyper-local business ads. Show real customers, the physical location, staff, services, community presence, local offers, and trust signals. Make it feel authentic and neighbourhood-level.",
    requiredAdTypes: [
      "Local Customer Story",
      "Behind the Scenes",
      "Service Demo",
      "Trust / Proof",
      "Location Spotlight",
      "Offer / Promo",
      "Community Angle",
      "Review / Testimonial",
    ],
  },
  "Faith / Ministry Reels": {
    focus:
      "All 8 concepts must be respectful, warm, and inviting faith or ministry content. Keep it positive, modern, and visually compelling. Avoid clichés. Include encouragement, testimony, scripture-inspired visuals, prayer moments, and a clear invitation.",
    requiredAdTypes: [
      "Question Hook",
      "Encouragement Reel",
      "Testimony Style",
      "Prayer Moment",
      "Scripture-Inspired Visual",
      "Apparel / Product Lifestyle",
      "Street / Everyday Faith",
      "Invitation / CTA",
    ],
  },
  "Viral Social Clips": {
    focus:
      "All 8 concepts must be engineered for maximum organic reach and sharing. Every concept should have a pattern interrupt, unexpected element, or emotional peak. Use viral formats: POV, relatable problems, curiosity hooks, fast montages, surprise endings, and shareable one-liners.",
    requiredAdTypes: [
      "Pattern Interrupt",
      "Curiosity Hook",
      "Unexpected Reveal",
      "Fast Montage",
      "POV Moment",
      "Relatable Problem",
      "Surprise Ending",
      "Shareable One-Liner",
    ],
  },
};

// Fallback for unknown batch types
const DEFAULT_STRATEGY: BatchTypeStrategy = BATCH_TYPE_STRATEGIES["General Product Ads"]!;

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

function buildSystemPrompt(
  brandName: string,
  workspaceKey: string,
  batchType: string,
  strategy: BatchTypeStrategy,
  includeVoiceover: boolean,
): string {
  const guidance = BRAND_GUIDANCE[workspaceKey] ?? NEUTRAL_BRAND_GUIDANCE;
  const adTypeList = strategy.requiredAdTypes
    .map((t, i) => `  ${i + 1}. ${t}`)
    .join("\n");

  const voiceoverRule = includeVoiceover
    ? `14. VOICEOVER / TALKING RULE — THIS IS MANDATORY: Every promptText must include short spoken lines in double quotation marks directed at a real person/creator. The prompt must describe the creator speaking naturally.
    Required in every promptText:
    a) An opening spoken hook in quotes — e.g. "This just changed my morning routine."
    b) One product or context line in quotes — e.g. "I've been wearing this for two weeks straight."
    c) A closing CTA line in quotes — e.g. "Tap to grab yours." or "Link is in bio."
    d) Visual action description (what we see on screen)
    e) Camera direction (handheld, selfie cam, close-up, slow pull-back, etc.)
    f) Audio direction: natural creator voice, clear speech, casual conversational tone, no music overlay
    GOOD example: Use @product1 as the exact product reference. Creator holds @product1 toward camera and says, "This is my new favorite tee." Quick cut to them wearing it outside, they smile and say, "It goes with everything." They point to camera and say, "Tap to grab yours." Selfie cam, bright natural daylight, authentic handheld UGC style.
    BAD example (no speech): A person walks down the street holding a shirt. Cinematic. Slow motion. — WRONG because there is no spoken hook.`
    : `14. VISUAL-ONLY RULE: promptText should describe visual action, setting, camera movement, and lighting only. Do not include spoken lines or dialogue. Specify ambient audio or background music only.`;

  return `You are an expert short-form video concept writer specialising in social media ads and organic content for any type of brand, product, or service.

Brand context:
- Brand name: ${brandName}
- Batch type: ${batchType}
- Brand style guidance: ${guidance}
- Include voiceover/talking: ${includeVoiceover ? "YES — every prompt must include spoken lines" : "NO — visual-only prompts"}

Your job is to generate exactly 8 video concepts for Seedance 2.0 AI video generation.

STRICT RULES — follow these exactly:
1. Output ONLY valid JSON. No markdown, no explanation, no code fences.
2. Generate exactly 8 items in the "items" array.
3. Each video concept is 8 seconds long, 9:16 vertical format.
4. Do NOT invent logos, slogans, shirt text, product claims, pricing, or brand promises not present in the brief or reference images.
5. Do NOT add religious, faith, or spiritual language unless the brand context, batch type, or instruction specifically calls for it.
6. Do NOT mention AI in any video concept.
7. Do NOT include end-card or outro instructions in promptText.
8. Do NOT use placeholder words like "[product]" or "[your brand]".
9. promptText must be Seedance-ready. ${includeVoiceover ? "Include spoken lines as described in rule 14. Under 500 characters." : "Subject, action, setting, camera movement, lighting. Under 300 characters."}
10. Caption must be social-ready with relevant hashtags and a call to action.
11. PLATFORM RULE: Do NOT write concepts for a specific platform. Every concept must work for Instagram Reels, TikTok, YouTube Shorts, and Facebook Reels equally. Do not mention platform names in promptText.
12. IMAGE TAG RULE — THIS IS MANDATORY: If reference images are provided with tags (e.g. @product1, @logo, @model1), every single promptText MUST explicitly include at least one of those exact tags written literally. You MUST NOT reference uploaded images without using their tag. You MUST NOT use generic substitutes like "the product", "the image", or "the shirt" instead of the tag. Write tags literally exactly as provided, for example:
    - BAD: "A person holds up a shirt in front of a white background."
    - GOOD: "Use @product1 as the exact product reference. A person holds up @product1 in front of a white background, close-up reveal, cinematic lighting."
    - GOOD (multiple tags): "@model1 holds @product1 against a golden hour backdrop, slow pull-back, shallow depth of field."
    If only one image is provided (e.g. @product1 only), every single promptText must include @product1.
    If multiple images exist, every promptText must include at minimum the primary product tag (the first one), plus additional tags where relevant.
13. BATCH TYPE STRATEGY — THIS IS MANDATORY: The selected batch type is "${batchType}".
    Creative focus: ${strategy.focus}
    You MUST generate all 8 concepts strictly within this batch type. Do NOT mix in general lifestyle or cinematic concepts unless that is what this batch type calls for.
    You MUST use these exact 8 ad type labels, in this exact order, one per item:
${adTypeList}
    Each item's "adType" field MUST match the corresponding label from the list above.
    Do NOT substitute, skip, or reorder these ad types.
${voiceoverRule}

JSON schema to return:
{
  "batchTitle": "short descriptive title for this batch campaign",
  "items": [
    {
      "title": "short concept title",
      "adType": "must exactly match the required ad type for this position",
      "hook": "the first 3 seconds — what grabs attention immediately",
      "promptText": "Seedance-ready video generation prompt. ${includeVoiceover ? "Must include spoken lines in double quotes." : "Visual description only."}",
      "caption": "social post caption with hashtags",
      "reason": "1 sentence on why this concept works for this brand and batch type"
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
    const tagList = referenceImages.map((img) => img.tag).join(", ");
    const imageList = referenceImages
      .map((img) => `  - ${img.tag}: ${img.name ?? "image"}`)
      .join("\n");
    imageSection = `

Uploaded reference images (use these EXACT tags in every promptText):
${imageList}

MANDATORY TAG RULES — you will fail if you break these:
1. Every single promptText MUST contain at least one of these tags written literally: ${tagList}
2. Never say "the product", "the shirt", or "the image" — use the tag (e.g. @product1) instead.
3. The primary image tag is ${referenceImages[0].tag}. If you are unsure which tag to use, use ${referenceImages[0].tag}.
4. You may use multiple tags in one prompt (e.g. "@model1 wearing @product1 in front of @brandcard").
5. Do not invent product details, text, or design elements not described in the campaign brief.

Example of a CORRECT promptText: "Use @product1 as the exact product reference. A hand pulls @product1 out of a white box, overhead shot, soft studio lighting, slow motion reveal."
Example of a WRONG promptText: "A person holds up a shirt. Cinematic. Slow motion." — WRONG because it does not use the image tag.`;
  } else if (legacyImageUrl) {
    imageSection = `

Reference image: ${legacyImageUrl}
Use the visual content of this image as the anchor for all 8 concepts. Preserve any visible brand details exactly.`;
  }

  const tagReminder = referenceImages.length > 0
    ? `\n\nFINAL REMINDER: You MUST include at least one image tag (${referenceImages.map(i => i.tag).join(", ")}) in every single promptText field. This is non-negotiable.`
    : "";

  return `Campaign brief: ${instruction}${imageSection}${tagReminder}

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
    includeVoiceover?: boolean;
  };

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Batch types where voiceover defaults to ON (all except General Product Ads)
  const VOICEOVER_DEFAULT_ON_TYPES = new Set([
    "UGC Ads", "Ecommerce Product Ads", "Product Launch", "Viral Social Clips",
    "App / Software Promo", "Local Business Ads", "Faith / Ministry Reels",
  ]);

  const {
    workspaceKey = "gotjesus",
    brandName = "Got Jesus?",
    instruction,
    batchType = "General Product Ads",
    referenceImages = [],
    referenceImageUrl,
    batchSize: rawBatchSize,
    includeVoiceover,
  } = body;

  // If includeVoiceover is not explicitly sent, apply the smart default
  const resolvedVoiceover: boolean =
    typeof includeVoiceover === "boolean"
      ? includeVoiceover
      : VOICEOVER_DEFAULT_ON_TYPES.has(batchType);

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

  const strategy = BATCH_TYPE_STRATEGIES[batchType] ?? DEFAULT_STRATEGY;

  const systemPrompt = buildSystemPrompt(brandName, workspaceKey, batchType, strategy, resolvedVoiceover);
  const userPrompt = buildUserPrompt(instruction, referenceImages, referenceImageUrl);

  console.log(
    `[batch-plan] Requesting ${batchSize} concepts for workspace=${workspaceKey} ` +
    `brand="${brandName}" refImages=${referenceImages.length} voiceover=${resolvedVoiceover}`
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

  // Server-side enforce adType from strategy — GPT can miss/reorder these.
  // We keep GPT's title/hook/promptText/caption but set adType deterministically.
  for (let i = 0; i < items.length; i++) {
    items[i].adType = strategy.requiredAdTypes[i] ?? items[i].adType;
  }

  // Server-side auto-fix: if voiceover is on and GPT returned no quoted speech,
  // append a minimal spoken hook + CTA so Seedance still gets voice direction.
  if (resolvedVoiceover) {
    for (const item of items) {
      const hasQuotedSpeech = item.promptText.includes('"') || item.promptText.includes("\u2018") || item.promptText.includes("\u2019") || item.promptText.includes("\u201c") || item.promptText.includes("\u201d");
      if (!hasQuotedSpeech && item.promptText.trim().length > 0) {
        item.promptText =
          item.promptText.trimEnd() +
          ` Creator says, "You've got to see this." Ends with, "Check it out today." Natural conversational voice, casual delivery.`;
        console.log(`[batch-plan] Auto-fixed voiceover for "${item.title}"`);
      }
    }
  }

  // Server-side auto-fix: if GPT missed tags, prepend the primary tag reference.
  // This guarantees every promptText references at least one uploaded image.
  if (referenceImages.length > 0) {
    const allTags = referenceImages.map((img) => img.tag);
    const primaryTag = allTags[0];
    for (const item of items) {
      const hasTag = allTags.some((tag) => item.promptText.includes(tag));
      if (!hasTag && item.promptText.trim().length > 0) {
        item.promptText = `Use ${primaryTag} as the exact visual reference. ${item.promptText}`;
        console.log(`[batch-plan] Auto-fixed promptText for "${item.title}" — added ${primaryTag} tag`);
      }
    }
  }

  const response: BatchPlanResponse = {
    batchTitle: parsed.batchTitle ?? `${brandName} Batch Campaign`,
    workspaceKey,
    brandName,
    batchType,
    includeVoiceover: resolvedVoiceover,
    items,
  };

  console.log(
    `[batch-plan] Returning ${items.length} concepts for "${response.batchTitle}"`
  );

  return NextResponse.json(response);
}
