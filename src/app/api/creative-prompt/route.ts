/**
 * POST /api/creative-prompt
 *
 * Uses OpenAI to improve a Content Engine slot's Seedance 2.0 prompt.
 * Returns an improved prompt with timing, camera, and creative suggestions.
 *
 * STRICT: Does NOT call Kie.ai, Blotato, or any video generation service.
 * Does NOT auto-generate, auto-post, or save anything.
 * Does NOT change ContentSlot state — the caller decides whether to apply the result.
 */

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

interface SlotImage {
  url: string;
  path: string;
  name: string;
  tag?: string;
  info?: string;
}

interface CreativeRequest {
  workspaceKey?: string;
  brandName?: string;
  slotName?: string;
  currentPrompt: string;
  postCaption?: string;
  referenceImages?: SlotImage[];
  durationSeconds?: number;
  aspectRatio?: string;
  officialEndCardEnabled?: boolean;
}

interface CreativeResult {
  improvedPrompt: string;
  suggestedPostCaption: string;
  hook: string;
  reason: string;
}

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  return new OpenAI({ apiKey });
}

function buildSystemPrompt(
  durationSeconds: number,
  officialEndCardEnabled: boolean,
  allowedTagList: string,
): string {
  const mainDuration = officialEndCardEnabled ? durationSeconds - 1 : durationSeconds;
  const closing = officialEndCardEnabled ? mainDuration - 1 : mainDuration;

  return `You are an expert Seedance 2.0 AI video prompt writer for short-form vertical reels.
Your task: improve or rewrite the provided Seedance prompt to make it produce a more compelling, cinematic, and specific reel.

STRICT RULES — follow every one:
1. Output ONLY valid JSON. No markdown, no code fences, no explanation outside the JSON.
2. improvedPrompt must be Seedance-ready: concrete subject, action, setting, camera style, lighting. Under 450 characters.
3. Format timing as three phases inside improvedPrompt:
   "0–2s: [opening action]. 2–5s: [main action]. 5–${closing}s: [closing reveal]."
   ${officialEndCardEnabled ? `Write content for ${mainDuration} seconds only. End with: "Official 1-second end card is appended automatically by the app."` : ""}
4. Include camera direction (e.g. handheld close-up, slow pull-back, overhead flat lay, selfie cam, tracking shot).
5. Include lighting and location (e.g. golden hour outdoor, studio rim lighting, natural kitchen window light, moody street ambience).
6. NO TEXT OVERLAY RULE — MANDATORY: Never ask Seedance to show captions, subtitles, text overlays, logo cards, CTAs on screen, hook text on screen, or any words on screen. The video must be visually clean with zero on-screen text.
7. TAG RULE — MANDATORY:
   ${allowedTagList
     ? `Allowed tags: ${allowedTagList}. You MUST include at least one of these tags literally in improvedPrompt. Do NOT invent or use any @tag not in this list.`
     : "No reference images uploaded. Do NOT invent or use any @tags in improvedPrompt. Describe the subject visually."}
8. Preserve any strong, specific visual direction from the original prompt.
9. Make it engaging, specific, and cinematic — not generic.
10. suggestedPostCaption: social-media ready, max 150 characters, include relevant hashtags.
11. hook: describe what happens in the first 2 seconds (the attention-grabbing moment). One sentence.
12. reason: one sentence explaining what was improved vs the original prompt.
13. Do NOT mention AI, Seedance, or generation tools inside the prompts.

JSON schema:
{
  "improvedPrompt": "Full Seedance-ready prompt with timing, camera, lighting",
  "suggestedPostCaption": "Social posting caption with hashtags",
  "hook": "First 2 seconds — what grabs attention",
  "reason": "One sentence on what was improved"
}`;
}

function buildUserPrompt(
  slotName: string,
  currentPrompt: string,
  postCaption: string,
  referenceImages: SlotImage[],
  durationSeconds: number,
  officialEndCardEnabled: boolean,
): string {
  const imageSection =
    referenceImages.length > 0
      ? `\nReference images (use these EXACT tags in improvedPrompt):\n` +
        referenceImages
          .map((img) => {
            const desc = img.info?.trim() || img.name?.trim() || "reference image";
            return `  - ${img.tag || img.name}: ${desc}`;
          })
          .join("\n") +
        `\nAllowed tags: ${referenceImages.map((i) => i.tag || i.name).join(", ")}`
      : "\nNo reference images uploaded.";

  return `Slot name: ${slotName || "Content Slot"}
Current Seedance prompt: ${currentPrompt || "(empty — write a strong prompt from scratch)"}
Post caption (for context): ${postCaption || "(none)"}
Duration: ${durationSeconds} seconds${officialEndCardEnabled ? " (official 1s end card appended by app)" : ""}
${imageSection}

Improve this Seedance prompt. Return only valid JSON.`;
}

const GENERIC_CREATORS = [
  "a young woman in casual wear",
  "an athletic man in gym gear",
  "a college student",
  "an entrepreneur in a minimal outfit",
  "a person in streetwear",
];

export async function POST(req: NextRequest) {
  let body: CreativeRequest;
  try {
    body = (await req.json()) as CreativeRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const {
    slotName = "Content Slot",
    currentPrompt = "",
    postCaption = "",
    referenceImages = [],
    durationSeconds = 8,
    officialEndCardEnabled = false,
  } = body;

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  const imagesWithTags = referenceImages.filter((img) => img.tag?.startsWith("@"));
  const allowedTagList = imagesWithTags.map((img) => img.tag!).join(", ");

  const systemPrompt = buildSystemPrompt(durationSeconds, officialEndCardEnabled, allowedTagList);
  const userPrompt = buildUserPrompt(
    slotName, currentPrompt, postCaption,
    referenceImages, durationSeconds, officialEndCardEnabled,
  );

  let rawContent = "";
  try {
    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.75,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    rawContent = completion.choices[0]?.message?.content ?? "";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[creative-prompt] OpenAI error:", message);
    return NextResponse.json({ error: `OpenAI request failed: ${message}` }, { status: 500 });
  }

  // Parse OpenAI response
  let result: CreativeResult;
  try {
    result = JSON.parse(rawContent) as CreativeResult;
    if (!result.improvedPrompt) throw new Error("Missing improvedPrompt");
  } catch {
    console.error("[creative-prompt] Parse error. Raw:", rawContent.slice(0, 200));
    return NextResponse.json(
      { error: "GPT returned malformed JSON. Try again." },
      { status: 500 }
    );
  }

  // ── Server-side cleanup ───────────────────────────────────────────────────
  // 1. Remove invented @tags not in allowed list
  if (imagesWithTags.length > 0) {
    const allowedSet = new Set(imagesWithTags.map((img) => img.tag!.toLowerCase()));
    const primaryTag = imagesWithTags[0]!.tag!;
    const tagMatches = result.improvedPrompt.match(/@[a-zA-Z0-9_-]+/g) ?? [];
    for (const tag of tagMatches) {
      if (!allowedSet.has(tag.toLowerCase())) {
        const lower = tag.toLowerCase();
        let replacement: string;
        if (lower.includes("model") || lower.includes("person") || lower.includes("creator")) {
          replacement = GENERIC_CREATORS[0]!;
        } else if (lower.includes("logo")) {
          replacement = "the brand";
        } else if (lower.includes("endcard") || lower.includes("end_card")) {
          replacement = "";
        } else {
          replacement = primaryTag;
        }
        result.improvedPrompt = result.improvedPrompt.split(tag).join(replacement);
        console.log(`[creative-prompt] Removed invented tag ${tag} → "${replacement}"`);
      }
    }
    // 2. Ensure at least one allowed tag appears
    const hasAllowedTag = imagesWithTags.some((img) => result.improvedPrompt.includes(img.tag!));
    if (!hasAllowedTag) {
      result.improvedPrompt = `Use ${primaryTag} as the exact visual reference. ${result.improvedPrompt}`;
      console.log(`[creative-prompt] Auto-prepended primary tag ${primaryTag}`);
    }
  } else if (referenceImages.length === 0) {
    // No images: remove any @ tags GPT may have invented
    result.improvedPrompt = result.improvedPrompt.replace(/@[a-zA-Z0-9_-]+/g, (match) => {
      console.log(`[creative-prompt] Stripped invented tag (no images) ${match}`);
      return "the subject";
    });
  }

  // 3. Enforce no-text-overlay rule in the returned prompt if missing
  const noTextSentence = "No text overlays, captions, or on-screen words.";
  if (!result.improvedPrompt.toLowerCase().includes("no text")) {
    result.improvedPrompt = `${result.improvedPrompt} ${noTextSentence}`;
  }

  // 4. Ensure timing structure exists
  const hasTimingPattern = /0.{0,2}[–-].{0,3}2s|Opening|0–2/.test(result.improvedPrompt);
  if (!hasTimingPattern && result.improvedPrompt.length < 400) {
    console.log("[creative-prompt] Timing structure missing — GPT returned content without it; accepting as-is.");
  }

  console.log(
    `[creative-prompt] Improved prompt for slot "${slotName}" (${result.improvedPrompt.length} chars)`
  );

  return NextResponse.json({
    improvedPrompt: result.improvedPrompt.trim(),
    suggestedPostCaption: (result.suggestedPostCaption ?? "").trim(),
    hook: (result.hook ?? "").trim(),
    reason: (result.reason ?? "").trim(),
  });
}
