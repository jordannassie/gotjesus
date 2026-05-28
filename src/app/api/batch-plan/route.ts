/**
 * POST /api/batch-plan
 *
 * Uses OpenAI to generate N platform-neutral, Seedance-ready video concepts.
 * Returns structured JSON ready for Seedance 2.0 generation via Kie.ai.
 *
 * This route ONLY generates concepts. It does not:
 *   - Call Kie.ai or Seedance
 *   - Save anything to Supabase
 *   - Post to any social platform
 *
 * Body:
 *   workspaceKey      string    optional  default "gotjesus"
 *   brandName         string    optional  default "Got Jesus?"
 *   instruction       string   REQUIRED  campaign brief
 *   batchType         string    optional  "UGC Ads" | "General Reels" — default "General Reels"
 *   referenceImages   Array<{ tag, name?, url }>  optional  tagged reference images
 *   referenceImageUrl string    optional  legacy single-image fallback
 *   batchSize         number    optional  1–8, default 4
 *   includeVoiceover  boolean   optional  smart default by batch type
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
  batchSize: number;
  includeVoiceover: boolean;
  items: BatchItem[];
}

// ─── Ad play libraries ────────────────────────────────────────────────────────
// Server-side randomly selects N plays from the appropriate library before
// calling OpenAI. GPT then writes the creative for each selected play.
// This guarantees variety and prevents GPT from always returning the same formats.

const UGC_AD_PLAYS: string[] = [
  "UGC Hook + Product Reveal",
  "UGC Problem / Solution",
  "UGC Try-On or Demo",
  "UGC Unboxing / First Look",
  "UGC Review Reaction",
  "UGC 3 Reasons Why",
  "UGC Lifestyle Use Case",
  "UGC Social Proof / Testimonial",
  "UGC POV Discovery",
  "UGC Gift / Surprise Reaction",
  "UGC Objection Crusher",
  "UGC Before / After Feeling",
];

const GENERAL_REEL_PLAYS: string[] = [
  "Product Hero Shot",
  "Lifestyle Scene",
  "Cinematic Reveal",
  "Product Detail Close-Up",
  "Problem / Solution Visual",
  "Unboxing / Packaging Moment",
  "Fast Montage",
  "Wildcard Creative",
  "Street / Lifestyle Moment",
  "Transformation Shot",
  "Brand Mood Shot",
  "Product-in-Use Story",
];

/** Fisher-Yates shuffle, returns `count` unique items from the library. */
function selectRandomPlays(library: string[], count: number): string[] {
  const shuffled = [...library];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

// ─── No-text-overlay suffix ───────────────────────────────────────────────────
// Always appended server-side if missing. Prevents Seedance from adding
// misspelled or unwanted captions/subtitles to generated video frames.

const NO_TEXT_SUFFIX =
  "No captions, no subtitles, no text overlays, no extra words on screen, no fake logos, do not alter product design.";

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
  batchSize: number,
  selectedPlays: string[],
  includeVoiceover: boolean,
): string {
  const guidance = BRAND_GUIDANCE[workspaceKey] ?? NEUTRAL_BRAND_GUIDANCE;
  const isUgc = batchType === "UGC Ads";

  const playsListText = selectedPlays
    .map((p, i) => `  ${i + 1}. ${p}`)
    .join("\n");

  const creativeModeFocus = isUgc
    ? "All concepts must be authentic, creator-style UGC ads. Shoot in portrait, handheld, natural-light, real-person style. No polished studio production. Concepts must feel genuinely filmed by real customers or creators."
    : "All concepts must be engaging product or brand reels. Use a wide variety of visual styles: lifestyle, cinematic, product demo, unboxing, problem-solution, fast montage, and brand mood. Each concept must look distinct from the others.";

  const voiceoverRule = includeVoiceover
    ? `13. VOICEOVER / TALKING RULE — MANDATORY: Every promptText must include short spoken lines in double quotation marks directed at a real person/creator.
    Required elements in every promptText:
    a) Opening spoken hook in quotes — e.g. "This just changed my morning routine."
    b) Product or context line in quotes — e.g. "I've been wearing this every day."
    c) Closing CTA line in quotes — e.g. "Tap to grab yours." or "Link is in bio."
    d) Visual action description
    e) Camera direction (handheld, selfie cam, close-up, slow pull-back, etc.)
    f) Audio direction: natural creator voice, clear speech, casual conversational tone
    GOOD: Creator holds @product1 toward camera and says, "This is my new favorite tee." Cuts to wearing it outside, they say, "It goes with everything." Points to camera: "Tap to grab yours." Selfie cam, bright natural daylight, authentic UGC style.
    BAD (no speech): A person walks holding a shirt. Cinematic. Slow motion. — WRONG.`
    : `13. VISUAL-ONLY RULE: promptText describes visual action, setting, camera movement, and lighting only. Do not include spoken lines or dialogue. Specify ambient audio or background music.`;

  return `You are an expert short-form video concept writer for social media ads.

Brand context:
- Brand name: ${brandName}
- Batch type: ${batchType}
- Brand style guidance: ${guidance}
- Include voiceover/talking: ${includeVoiceover ? "YES — every prompt must include spoken lines in quotes" : "NO — visual-only prompts"}

Your job is to generate exactly ${batchSize} video concepts for Seedance 2.0 AI video generation.

STRICT RULES — follow every single one:
1. Output ONLY valid JSON. No markdown, no explanation, no code fences.
2. Generate exactly ${batchSize} items in the "items" array.
3. Each video concept is 8 seconds long, 9:16 vertical format.
4. Do NOT invent logos, slogans, shirt text, product claims, pricing, or brand promises not present in the brief or reference images.
5. Do NOT add religious, faith, or spiritual language unless the brand context or instruction specifically calls for it.
6. Do NOT mention AI in any video concept.
7. Do NOT include end-card or outro instructions in promptText.
8. Do NOT use placeholder words like "[product]" or "[your brand]".
9. promptText must be Seedance-ready. ${includeVoiceover ? "Include spoken lines as described in rule 13. Under 500 characters." : "Subject, action, setting, camera movement, lighting. Under 400 characters."}
10. Caption is for social posting only — do NOT put captions, hashtags, or post text in promptText.
11. PLATFORM RULE: Do NOT write concepts for a specific platform. Every concept must work for Instagram Reels, TikTok, YouTube Shorts, and Facebook Reels equally.
12. IMAGE TAG RULE — MANDATORY: If reference images are provided with tags (e.g. @product1, @logo, @model1), every single promptText MUST include at least one tag literally. Never substitute "the product", "the shirt", or "the image" for the tag. Examples:
    - BAD: "A person holds up a shirt in front of a white background."
    - GOOD: "Use @product1 as the exact product reference. Creator holds up @product1, close-up reveal, cinematic lighting."
    - GOOD: "@model1 holds @product1 against golden hour backdrop, slow pull-back, shallow depth of field."
    Every promptText must contain at least one of the provided image tags.
${voiceoverRule}
14. NO TEXT OVERLAY RULE — MANDATORY: Never ask Seedance to show captions, subtitles, text overlays, hook text on screen, CTA text on screen, or any extra words on screen. Do NOT include instructions like "text on screen says", "caption reads", "overlay text", "show the word", or similar. Video must be clean with no on-screen text. End every promptText with: "No captions, no subtitles, no text overlays, no extra words on screen, no fake logos, do not alter product design."
15. CREATIVE MODE: ${creativeModeFocus}
16. AD PLAY STRATEGY — MANDATORY: Use exactly the following ${batchSize} ad plays, in this exact order:
${playsListText}
    - item[i].adType MUST exactly match play[i] from the list above.
    - Do NOT substitute, skip, or reorder these ad plays.
    - Do NOT create more or fewer than ${batchSize} items.
17. TIMING STRUCTURE: Each promptText should briefly describe what happens at three phases — opening (0–2 sec), middle (2–5 sec), closing (5–8 sec). Keep it concise.

JSON schema to return:
{
  "batchTitle": "short descriptive title for this batch",
  "items": [
    {
      "title": "short concept title",
      "adType": "must exactly match the ad play for this position",
      "hook": "the first 2 seconds — what grabs attention",
      "promptText": "Full Seedance-ready prompt. ${includeVoiceover ? "Include spoken lines in double quotes." : "Visual description only."} Must end with: No captions, no subtitles, no text overlays, no extra words on screen, no fake logos, do not alter product design.",
      "caption": "social post caption with hashtags — this is for posting only, NOT for the video",
      "reason": "1 sentence on why this ad play works for this brand"
    }
  ]
}`;
}

function buildUserPrompt(
  instruction: string,
  batchSize: number,
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

MANDATORY TAG RULES:
1. Every single promptText MUST contain at least one of these tags written literally: ${tagList}
2. Never say "the product", "the shirt", or "the image" — use the exact tag (e.g. ${referenceImages[0].tag}) instead.
3. Primary tag: ${referenceImages[0].tag}. If unsure which to use, use ${referenceImages[0].tag}.
4. You may combine tags in one prompt (e.g. "@model1 wearing @product1").
5. Do not invent product details, text, or design elements not described in the brief.`;
  } else if (legacyImageUrl) {
    imageSection = `

Reference image: ${legacyImageUrl}
Use the visual content of this image as the anchor for all ${batchSize} concepts. Preserve visible brand details exactly.`;
  }

  const tagReminder =
    referenceImages.length > 0
      ? `\n\nFINAL REMINDER: Every promptText MUST include at least one image tag (${referenceImages.map((i) => i.tag).join(", ")}). This is non-negotiable.`
      : "";

  return `Campaign brief: ${instruction}${imageSection}${tagReminder}

Generate exactly ${batchSize} video concepts now. Return only valid JSON matching the schema.`;
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
    title:           raw.title      ?? `Concept ${index + 1}`,
    adType:          raw.adType     ?? "Lifestyle",
    hook:            raw.hook       ?? "",
    promptText:      raw.promptText ?? "",
    caption:         raw.caption    ?? "",
    reason:          raw.reason     ?? "",
    platform:        "All Platforms",
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

  const {
    workspaceKey = "gotjesus",
    brandName = "Got Jesus?",
    instruction,
    batchType = "General Reels",
    referenceImages = [],
    referenceImageUrl,
    batchSize: rawBatchSize,
    includeVoiceover,
  } = body;

  // Voiceover defaults to ON for UGC Ads, OFF for General Reels
  const resolvedVoiceover: boolean =
    typeof includeVoiceover === "boolean"
      ? includeVoiceover
      : batchType === "UGC Ads";

  if (!instruction || instruction.trim().length === 0) {
    return NextResponse.json(
      { error: "instruction is required and must not be empty." },
      { status: 400 }
    );
  }

  // batchSize: 1–8, default 4
  const batchSize = Math.min(8, Math.max(1, Math.round(Number(rawBatchSize) || 4)));

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY environment variable is not set." },
      { status: 500 }
    );
  }

  // Select ad plays server-side (random, not chosen by GPT)
  const isUgc = batchType === "UGC Ads";
  const adPlayLibrary = isUgc ? UGC_AD_PLAYS : GENERAL_REEL_PLAYS;
  const selectedPlays = selectRandomPlays(adPlayLibrary, batchSize);

  console.log(
    `[batch-plan] workspace=${workspaceKey} type=${batchType} size=${batchSize} ` +
    `voiceover=${resolvedVoiceover} refImages=${referenceImages.length} ` +
    `plays=[${selectedPlays.join(", ")}]`
  );

  const openai = new OpenAI({ apiKey });

  const systemPrompt = buildSystemPrompt(
    brandName, workspaceKey, batchType, batchSize, selectedPlays, resolvedVoiceover
  );
  const userPrompt = buildUserPrompt(instruction, batchSize, referenceImages, referenceImageUrl);

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
    return NextResponse.json({ error: `OpenAI request failed: ${message}` }, { status: 500 });
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

  // Normalise and trim/pad to exact batchSize
  const items: BatchItem[] = parsed.items
    .slice(0, batchSize)
    .map((item, i) => normaliseItem(item, i));

  while (items.length < batchSize) {
    items.push(normaliseItem({}, items.length));
  }

  // ── Server-side fixes (applied in order) ────────────────────────────────────

  // 1. Force adType from selected plays (GPT may rename/reorder)
  for (let i = 0; i < items.length; i++) {
    items[i].adType = selectedPlays[i] ?? items[i].adType;
  }

  // 2. Voiceover auto-fix: append generic speech if GPT missed quoted lines
  if (resolvedVoiceover) {
    for (const item of items) {
      const hasQuotes =
        item.promptText.includes('"') ||
        item.promptText.includes("\u201c") || item.promptText.includes("\u201d");
      if (!hasQuotes && item.promptText.trim().length > 0) {
        item.promptText =
          item.promptText.trimEnd() +
          ` Creator says, "You've got to see this." Ends with, "Check it out today." Natural conversational voice, casual delivery.`;
        console.log(`[batch-plan] Auto-fixed voiceover for "${item.title}"`);
      }
    }
  }

  // 3. Image tag auto-fix: prepend primary tag if all tags are missing
  if (referenceImages.length > 0) {
    const allTags = referenceImages.map((img) => img.tag);
    const primaryTag = allTags[0]!;
    for (const item of items) {
      const hasTag = allTags.some((tag) => item.promptText.includes(tag));
      if (!hasTag && item.promptText.trim().length > 0) {
        item.promptText = `Use ${primaryTag} as the exact visual reference. ${item.promptText}`;
        console.log(`[batch-plan] Auto-fixed image tag for "${item.title}"`);
      }
    }
  }

  // 4. No-text-overlay auto-fix: append if not already present
  const noTextLower = NO_TEXT_SUFFIX.toLowerCase();
  for (const item of items) {
    const hasNoText =
      item.promptText.toLowerCase().includes("no captions") ||
      item.promptText.toLowerCase().includes("no text overlay") ||
      item.promptText.toLowerCase().includes("no subtitles");
    if (!hasNoText && item.promptText.trim().length > 0) {
      item.promptText = item.promptText.trimEnd() + " " + NO_TEXT_SUFFIX;
    }
    // Ensure caption does NOT bleed into promptText
    if (item.promptText.includes("#") && item.caption && item.promptText.includes(item.caption.slice(0, 20))) {
      // GPT accidentally put the social caption inside promptText — remove it
      item.promptText = item.promptText.replace(item.caption, "").trim();
      if (!item.promptText.toLowerCase().includes("no captions")) {
        item.promptText = item.promptText + " " + NO_TEXT_SUFFIX;
      }
    }
  }
  void noTextLower; // suppress unused variable warning

  const response: BatchPlanResponse = {
    batchTitle: parsed.batchTitle ?? `${brandName} Batch`,
    workspaceKey,
    brandName,
    batchType,
    batchSize,
    includeVoiceover: resolvedVoiceover,
    items,
  };

  console.log(`[batch-plan] Returning ${items.length} concepts for "${response.batchTitle}"`);
  return NextResponse.json(response);
}
