"use client";

import { useState, useCallback } from "react";
import { getWorkspaceName } from "@/lib/workspaces";

// ─── Types (mirror /api/batch-plan — defined locally to stay client-safe) ────

interface BatchItem {
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

interface BatchPlanResponse {
  batchTitle: string;
  workspaceKey: string;
  brandName: string;
  batchType: string;
  items: BatchItem[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BATCH_TYPES = [
  "Faith / Ministry Reels",
  "UGC Ads",
  "Product Launch",
  "App Download Ads",
  "Ecommerce Product Ads",
  "Local Business Ads",
];

const HOW_IT_WORKS = [
  {
    step: "1",
    label: "OpenAI writes the batch",
    detail: "Generates 8 video concepts from your campaign brief and optional reference image.",
  },
  {
    step: "2",
    label: "Seedance creates the videos",
    detail: "Each concept is sent to Kie.ai / Seedance 2.0 and rendered as a 9:16 reel.",
  },
  {
    step: "3",
    label: "Library stores the campaign",
    detail: "All generated reels are saved under this brand's Library for review.",
  },
  {
    step: "4",
    label: "You post the winners",
    detail: "Pick your favourites in Library and hit Post Now. Nothing posts automatically.",
  },
];

// ─── Concept Card ─────────────────────────────────────────────────────────────

function ConceptCard({ item, index }: { item: BatchItem; index: number }) {
  const [promptOpen, setPromptOpen] = useState(false);
  const [captionOpen, setCaptionOpen] = useState(false);

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950 overflow-hidden">
      {/* Card header */}
      <div className="px-4 py-3 border-b border-neutral-800 flex items-start gap-3 bg-neutral-900/40">
        <span
          className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5"
          style={{
            background: "linear-gradient(135deg, #a3e635, #22d3ee)",
            color: "#000",
          }}
        >
          {index + 1}
        </span>
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <span className="text-sm font-semibold text-white leading-tight">{item.title}</span>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-700 text-neutral-400">
              {item.adType}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-800 text-neutral-600">
              {item.platform}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-800 text-neutral-600">
              {item.durationSeconds}s · {item.aspectRatio}
            </span>
          </div>
        </div>
      </div>

      <div className="px-4 py-4 flex flex-col gap-3">
        {/* Hook */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-600">Hook</span>
          <p className="text-xs text-neutral-300 leading-relaxed">{item.hook}</p>
        </div>

        {/* Reason */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-600">Why it works</span>
          <p className="text-xs text-neutral-500 leading-relaxed">{item.reason}</p>
        </div>

        {/* Caption — collapsible */}
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => setCaptionOpen((v) => !v)}
            className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-600 hover:text-neutral-400 transition-colors w-fit"
          >
            Caption
            <svg
              className={`w-2.5 h-2.5 transition-transform ${captionOpen ? "rotate-180" : ""}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          {captionOpen && (
            <p className="text-xs text-neutral-500 leading-relaxed whitespace-pre-wrap">{item.caption}</p>
          )}
        </div>

        {/* Prompt — collapsible */}
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => setPromptOpen((v) => !v)}
            className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-600 hover:text-neutral-400 transition-colors w-fit"
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #a3e635, #22d3ee)" }}
            />
            Seedance Prompt
            <svg
              className={`w-2.5 h-2.5 transition-transform ${promptOpen ? "rotate-180" : ""}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          {promptOpen && (
            <p className="text-xs text-neutral-400 leading-relaxed bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 font-mono">
              {item.promptText}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── BatchTab ─────────────────────────────────────────────────────────────────

interface Props {
  workspaceKey?: string;
}

export default function BatchTab({ workspaceKey = "gotjesus" }: Props) {
  const brandName = getWorkspaceName(workspaceKey);

  const [instruction, setInstruction] = useState(
    "Make every type of reel this brand would actually need."
  );
  const [batchType, setBatchType] = useState(BATCH_TYPES[0]);
  const [referenceImageUrl, setReferenceImageUrl] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");
  const [batchPlan, setBatchPlan] = useState<BatchPlanResponse | null>(null);

  const canGenerate = instruction.trim().length > 0 && !isGenerating;

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return;
    setIsGenerating(true);
    setError("");
    setBatchPlan(null);

    try {
      const res = await fetch("/api/batch-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceKey,
          brandName,
          instruction: instruction.trim(),
          batchType,
          referenceImageUrl: referenceImageUrl.trim() || undefined,
          batchSize: 8,
        }),
      });

      const data = (await res.json()) as BatchPlanResponse & { error?: string };

      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      setBatchPlan(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batch plan generation failed.");
    } finally {
      setIsGenerating(false);
    }
  }, [workspaceKey, brandName, instruction, batchType, referenceImageUrl, canGenerate]);

  return (
    <div className="flex flex-col gap-6">

      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold tracking-widest uppercase text-neutral-600">Batch</span>
          <span className="text-[10px] text-neutral-700">—</span>
          <span className="text-[10px] font-semibold text-neutral-400">{brandName}</span>
        </div>
        <h2 className="text-base font-bold text-white tracking-tight">Batch Campaign Builder</h2>
        <p className="text-xs text-neutral-500 leading-relaxed max-w-lg">
          Upload one image. Generate a full campaign. Review and post your favorites.
        </p>
      </div>

      {/* How it works */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {HOW_IT_WORKS.map(({ step, label, detail }) => (
          <div
            key={step}
            className="flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-4"
          >
            <div className="flex items-center gap-2">
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                style={{ background: "linear-gradient(135deg, #a3e635, #22d3ee)", color: "#000" }}
              >
                {step}
              </span>
              <span className="text-[11px] font-semibold text-neutral-200 leading-snug">{label}</span>
            </div>
            <p className="text-[10px] text-neutral-600 leading-relaxed">{detail}</p>
          </div>
        ))}
      </div>

      {/* Campaign Builder card */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-950 overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-800">
          <h3 className="text-sm font-semibold text-white">New Batch Campaign</h3>
          <p className="text-xs text-neutral-600 mt-0.5">
            Configure your campaign for <span className="text-neutral-400">{brandName}</span>.
          </p>
        </div>

        <div className="px-5 py-5 flex flex-col gap-5">

          {/* Reference Image URL */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
              Reference Image URL
            </label>
            <input
              type="url"
              value={referenceImageUrl}
              onChange={(e) => setReferenceImageUrl(e.target.value)}
              disabled={isGenerating}
              placeholder="https://... paste an uploaded image URL"
              className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-sm text-neutral-200 placeholder-neutral-700 outline-none focus:border-neutral-600 focus:ring-1 focus:ring-neutral-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <p className="text-[10px] text-neutral-700 leading-relaxed">
              Paste an uploaded image URL for now. Direct upload coming later.
            </p>
          </div>

          {/* Campaign Instruction */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
              Campaign Brief
            </label>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              disabled={isGenerating}
              placeholder="Describe the campaign goal, tone, audience, and key message."
              rows={4}
              className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-sm text-neutral-200 placeholder-neutral-600 resize-none outline-none focus:border-neutral-600 focus:ring-1 focus:ring-neutral-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed leading-relaxed"
            />
          </div>

          {/* Batch Type */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
              Batch Type
            </label>
            <select
              value={batchType}
              onChange={(e) => setBatchType(e.target.value)}
              disabled={isGenerating}
              className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-sm text-neutral-200 outline-none focus:border-neutral-600 focus:ring-1 focus:ring-neutral-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed [color-scheme:dark]"
            >
              {BATCH_TYPES.map((t) => (
                <option key={t} value={t} className="bg-neutral-900">
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* Batch Size — locked at 8 for MVP */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
              Batch Size
            </label>
            <div className="flex items-center gap-2">
              <div className="px-4 py-1.5 rounded-lg border border-neutral-700 text-xs font-semibold text-white bg-neutral-800">
                8 videos
              </div>
              <span className="text-[10px] text-neutral-700">Locked at 8 for MVP</span>
            </div>
          </div>

          {/* Generate button */}
          <div className="flex items-center justify-between pt-1 flex-wrap gap-3">
            <p className="text-[11px] text-neutral-600 leading-relaxed max-w-xs">
              OpenAI will write 8 Seedance-ready video concepts. No videos are generated yet.
            </p>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                canGenerate
                  ? "bg-white text-black hover:bg-neutral-200"
                  : "bg-neutral-800 text-neutral-600 cursor-not-allowed opacity-60"
              }`}
            >
              {isGenerating ? (
                <>
                  <span
                    className="w-4 h-4 rounded-full animate-spin inline-block flex-shrink-0"
                    style={{
                      border: "2px solid transparent",
                      borderTopColor: "#a3e635",
                      borderRightColor: "#22d3ee",
                    }}
                  />
                  Generating Batch Plan…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                  </svg>
                  Generate Batch Plan
                </>
              )}
            </button>
          </div>

        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-900 bg-red-950/30 px-5 py-4">
          <p className="text-xs font-semibold text-red-400 mb-1">Batch plan failed</p>
          <p className="text-xs text-red-500 leading-relaxed">{error}</p>
        </div>
      )}

      {/* Results — 8 concept cards */}
      {batchPlan ? (
        <div className="flex flex-col gap-4">
          {/* Batch header */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] font-semibold tracking-widest uppercase text-neutral-600">Batch Plan</span>
              <h3 className="text-sm font-bold text-white">{batchPlan.batchTitle}</h3>
              <span className="text-[10px] text-neutral-600">{batchPlan.batchType} · {batchPlan.items.length} concepts · {brandName}</span>
            </div>
            <button
              type="button"
              onClick={() => { setBatchPlan(null); setError(""); }}
              className="text-xs text-neutral-600 hover:text-neutral-300 transition-colors border border-neutral-800 rounded-lg px-3 py-1.5"
            >
              New Batch
            </button>
          </div>

          {/* Concept cards grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {batchPlan.items.map((item, i) => (
              <ConceptCard key={i} item={item} index={i} />
            ))}
          </div>

          {/* Review note */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 px-5 py-4 flex items-start gap-3">
            <svg className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold text-neutral-300">Review these concepts first.</span>
              <p className="text-xs text-neutral-500 leading-relaxed">
                Next step will save the batch. Nothing generates or posts yet.
              </p>
            </div>
          </div>
        </div>
      ) : !isGenerating ? (
        /* Empty state — shown before first generation */
        <div className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/30 px-6 py-10 flex flex-col items-center justify-center gap-3 text-center">
          <svg className="w-8 h-8 text-neutral-700" viewBox="0 0 20 20" fill="currentColor">
            <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
          </svg>
          <p className="text-sm text-neutral-600">Your batch concepts will appear here.</p>
          <p className="text-xs text-neutral-700 max-w-xs leading-relaxed">
            Fill in the brief above and click Generate Batch Plan to see 8 campaign video concepts.
          </p>
        </div>
      ) : null}

      {/* Safety note — always shown */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 px-5 py-4 flex items-start gap-3">
        <svg className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold text-neutral-300">Nothing posts automatically.</span>
          <p className="text-xs text-neutral-500 leading-relaxed">
            Batch videos save to Library for review. You choose which ones to post using the Post Now button.
          </p>
        </div>
      </div>

    </div>
  );
}
