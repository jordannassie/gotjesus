"use client";

import { useState, useCallback, useRef } from "react";
import { getWorkspaceName } from "@/lib/workspaces";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReferenceImage {
  id: string;       // local client-side id
  tag: string;      // @product1, @logo, etc.
  name: string;     // filename
  url: string;      // public Supabase URL
}

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

// Per-item generation state — infrastructure for future step
type ItemGenStatus = "idle" | "submitting" | "generating" | "done" | "failed";
interface ItemGenState {
  status: ItemGenStatus;
  kieTaskId?: string;
  videoUrl?: string;
  error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BATCH_TYPES = [
  "General Product Ads",
  "UGC Ads",
  "Product Launch",
  "Ecommerce Product Ads",
  "App / Software Promo",
  "Local Business Ads",
  "Faith / Ministry Reels",
  "Viral Social Clips",
];

const DEFAULT_TAG_NAMES = [
  "@product1",
  "@product2",
  "@logo",
  "@model1",
  "@brandcard",
  "@endcard",
];

function defaultTagForIndex(index: number): string {
  if (index < DEFAULT_TAG_NAMES.length) return DEFAULT_TAG_NAMES[index];
  return `@ref${index + 1}`;
}

function normalizeTag(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

// ─── Supabase SQL hint ────────────────────────────────────────────────────────

function isSqlMissingError(message: string): boolean {
  return (
    message.includes("42P01") ||
    message.includes("does not exist") ||
    message.includes("relation") ||
    message.includes("{}") ||
    message === "createCampaignBatch failed: {}"
  );
}

// ─── Reference Image Card ─────────────────────────────────────────────────────

function ImageCard({
  image,
  index,
  allTags,
  onChange,
  onRemove,
}: {
  image: ReferenceImage;
  index: number;
  allTags: string[];
  onChange: (id: string, tag: string) => void;
  onRemove: (id: string) => void;
}) {
  const [tagInput, setTagInput] = useState(image.tag);
  const [tagError, setTagError] = useState("");

  const handleTagBlur = () => {
    const normalized = normalizeTag(tagInput);
    if (!normalized) {
      setTagInput(image.tag);
      setTagError("");
      return;
    }
    // Check duplicate
    const otherTags = allTags.filter((_, i) => i !== index);
    if (otherTags.includes(normalized)) {
      setTagError("Duplicate tag");
      return;
    }
    setTagError("");
    setTagInput(normalized);
    onChange(image.id, normalized);
  };

  const handleTagChange = (v: string) => {
    setTagInput(v);
    setTagError("");
  };

  return (
    <div className="flex items-start gap-2.5 p-2.5 rounded-xl border border-neutral-800 bg-neutral-900/60">
      {/* Thumbnail */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.url}
        alt={image.name}
        className="w-12 h-12 rounded-lg object-cover flex-shrink-0 border border-neutral-700"
      />
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <p className="text-[10px] font-medium text-neutral-300 truncate leading-tight">{image.name}</p>
        <div className="flex flex-col gap-0.5">
          <input
            type="text"
            value={tagInput}
            onChange={(e) => handleTagChange(e.target.value)}
            onBlur={handleTagBlur}
            onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
            className={`w-full bg-neutral-800 border rounded-lg px-2 py-1 text-[11px] font-mono text-neutral-200 outline-none transition-colors ${
              tagError ? "border-red-800 focus:border-red-600" : "border-neutral-700 focus:border-neutral-500"
            }`}
            placeholder="@tag"
          />
          {tagError && <p className="text-[10px] text-red-400">{tagError}</p>}
        </div>
      </div>
      {/* Remove */}
      <button
        type="button"
        onClick={() => onRemove(image.id)}
        title="Remove image"
        className="w-6 h-6 flex items-center justify-center rounded-md border border-neutral-700 text-neutral-600 hover:text-red-400 hover:border-red-900 transition-colors flex-shrink-0 mt-0.5"
      >
        ×
      </button>
    </div>
  );
}

// ─── Concept Card ─────────────────────────────────────────────────────────────

function ConceptCard({
  item,
  index,
  saved,
  itemId,
  genState,
  onDelete,
}: {
  item: BatchItem;
  index: number;
  saved: boolean;
  itemId?: string;
  genState?: ItemGenState;
  onDelete?: (itemId: string) => void;
}) {
  const [promptOpen, setPromptOpen] = useState(false);
  const [captionOpen, setCaptionOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = useCallback(async () => {
    if (!itemId || isDeleting) return;
    if (!confirm("Delete this concept? This cannot be undone.")) return;
    setIsDeleting(true);
    onDelete?.(itemId);
  }, [itemId, isDeleting, onDelete]);

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950 overflow-hidden">
      {/* Card header */}
      <div className="px-4 py-3 border-b border-neutral-800 flex items-start gap-3 bg-neutral-900/40">
        <span
          className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5"
          style={{ background: "linear-gradient(135deg, #a3e635, #22d3ee)", color: "#000" }}
        >
          {index + 1}
        </span>
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <span className="text-sm font-semibold text-white leading-tight">{item.title}</span>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Style badge — replaces platform badge */}
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-700 text-neutral-400">
              {item.adType}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-800 text-neutral-600">
              {item.durationSeconds}s · {item.aspectRatio}
            </span>
            {/* Status badge */}
            {saved ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-900 text-emerald-500">
                Saved
              </span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-800 text-neutral-600">
                Draft
              </span>
            )}
          </div>
        </div>

        {/* Per-card controls (only after save) */}
        {saved && itemId && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Generate Video — disabled until next step */}
            {(() => {
              const gs = genState;
              const gsStatus = gs?.status ?? "idle";
              if (gsStatus === "done" && gs?.videoUrl) {
                return (
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400 px-2.5 py-1.5 rounded-lg border border-emerald-900">
                    <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Video ready
                  </span>
                );
              }
              return (
                <button
                  type="button"
                  disabled
                  title="Video generation coming next step"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-neutral-800 text-[11px] font-medium text-neutral-700 cursor-not-allowed opacity-60"
                >
                  <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                  </svg>
                  Generate Video
                </button>
              );
            })()}

            {/* Delete item */}
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              title="Delete this concept"
              className="w-7 h-7 flex items-center justify-center rounded-lg border border-neutral-800 text-neutral-600 hover:text-red-400 hover:border-red-900 transition-colors disabled:opacity-40"
            >
              <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        )}
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
            <svg className={`w-2.5 h-2.5 transition-transform ${captionOpen ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          {captionOpen && (
            <p className="text-xs text-neutral-500 leading-relaxed whitespace-pre-wrap">{item.caption}</p>
          )}
        </div>

        {/* Seedance Prompt — collapsible */}
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => setPromptOpen((v) => !v)}
            className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-600 hover:text-neutral-400 transition-colors w-fit"
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: "linear-gradient(135deg, #a3e635, #22d3ee)" }}
            />
            Seedance Prompt
            <svg className={`w-2.5 h-2.5 transition-transform ${promptOpen ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          {promptOpen && (
            <p className="text-xs text-neutral-400 leading-relaxed bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 font-mono">
              {item.promptText}
            </p>
          )}
        </div>

        {/* Generation status (rendered when generation is enabled) */}
        {genState && genState.status !== "idle" && (
          <div className="mt-1">
            {(genState.status === "submitting" || genState.status === "generating") && (
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                <span
                  className="w-2.5 h-2.5 rounded-full animate-spin inline-block"
                  style={{ border: "2px solid transparent", borderTopColor: "#a3e635", borderRightColor: "#22d3ee" }}
                />
                {genState.status === "submitting" ? "Submitting to Kie.ai…" : `Generating… (${genState.kieTaskId?.slice(0, 8)}…)`}
              </div>
            )}
            {genState.status === "failed" && genState.error && (
              <p className="text-[11px] text-red-400">{genState.error}</p>
            )}
            {genState.status === "done" && genState.videoUrl && (
              <a href={genState.videoUrl} target="_blank" rel="noopener noreferrer"
                className="text-[11px] text-emerald-400 hover:text-emerald-300 underline underline-offset-2">
                View video ↗
              </a>
            )}
          </div>
        )}
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

  // ── Reference images (multi-upload) ────────────────────────────────────────
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [showUrlFallback, setShowUrlFallback] = useState(false);
  const [urlFallbackValue, setUrlFallbackValue] = useState("");
  const imageInputRef = useRef<HTMLInputElement>(null);

  // ── Mode ─────────────────────────────────────────────────────────────────────
  const [useChatGPT, setUseChatGPT] = useState(false);
  const [seedancePrompt, setSeedancePrompt] = useState(
    "Create an 8-second vertical 9:16 reel using @product1 as the exact product reference. Make it cinematic, fast-paced, and social-media ready."
  );
  const [chatGptInstruction, setChatGptInstruction] = useState(
    "Make every type of short-form ad this brand would actually need."
  );
  const [batchType, setBatchType] = useState(BATCH_TYPES[0]);

  // ── ChatGPT batch plan ───────────────────────────────────────────────────────
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [batchPlan, setBatchPlan] = useState<BatchPlanResponse | null>(null);

  // ── Save state ───────────────────────────────────────────────────────────────
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedBatchData, setSavedBatchData] = useState<{
    batchId: string;
    itemIds: string[];
  } | null>(null);

  // ── Delete state ─────────────────────────────────────────────────────────────
  const [isDeletingBatch, setIsDeletingBatch] = useState(false);
  const [deleteBatchError, setDeleteBatchError] = useState("");
  const [deletedItemIds, setDeletedItemIds] = useState<string[]>([]);

  // ── Gen state (future step) ──────────────────────────────────────────────────
  const [itemGenStates] = useState<Record<string, ItemGenState>>({});

  // Ref for cleanup on batch delete/new batch
  const itemTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // ── Derived ───────────────────────────────────────────────────────────────────
  const firstImageUrl =
    referenceImages[0]?.url ?? urlFallbackValue.trim() ?? "";
  const allTags = referenceImages.map((img) => img.tag);

  // ── Upload handler (loop over multiple files) ─────────────────────────────────

  const handleImageUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (!files.length) return;
      e.target.value = "";
      setIsUploading(true);
      setUploadError("");

      const newImages: ReferenceImage[] = [];
      const startIndex = referenceImages.length;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const form = new FormData();
          form.append("file", file);
          form.append("workspaceKey", workspaceKey);
          const res = await fetch("/api/campaign-batches/upload", {
            method: "POST",
            body: form,
          });
          const data = (await res.json()) as { url?: string; name?: string; error?: string };
          if (!res.ok || !data.url) throw new Error(data.error ?? "Upload failed.");
          newImages.push({
            id: `img-${Date.now()}-${i}`,
            tag: defaultTagForIndex(startIndex + newImages.length),
            name: data.name ?? file.name,
            url: data.url,
          });
        } catch (err) {
          setUploadError(err instanceof Error ? err.message : "Image upload failed.");
        }
      }

      if (newImages.length > 0) {
        setReferenceImages((prev) => [...prev, ...newImages]);
        setShowUrlFallback(false);
      }
      setIsUploading(false);
    },
    [workspaceKey, referenceImages.length]
  );

  const handleTagChange = useCallback((id: string, newTag: string) => {
    setReferenceImages((prev) =>
      prev.map((img) => (img.id === id ? { ...img, tag: newTag } : img))
    );
  }, []);

  const handleRemoveImage = useCallback((id: string) => {
    setReferenceImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  // ── Create 8 prompts ──────────────────────────────────────────────────────────

  const canCreatePrompts = chatGptInstruction.trim().length > 0 && !isGenerating && !isSaving;

  const handleCreatePrompts = useCallback(async () => {
    if (!canCreatePrompts) return;
    setIsGenerating(true);
    setGenerateError("");
    setBatchPlan(null);
    setSavedBatchData(null);
    setDeletedItemIds([]);
    try {
      const res = await fetch("/api/batch-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceKey,
          brandName,
          instruction: chatGptInstruction.trim(),
          batchType,
          referenceImages: referenceImages.map(({ tag, name, url }) => ({ tag, name, url })),
          referenceImageUrl: firstImageUrl || undefined,
          batchSize: 8,
        }),
      });
      const data = (await res.json()) as BatchPlanResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setBatchPlan(data);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Prompt generation failed.");
    } finally {
      setIsGenerating(false);
    }
  }, [workspaceKey, brandName, chatGptInstruction, batchType, referenceImages, firstImageUrl, canCreatePrompts]);

  // ── Save batch ────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!batchPlan || isSaving || savedBatchData) return;
    setIsSaving(true);
    setSaveError("");
    try {
      const res = await fetch("/api/campaign-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceKey,
          brandName,
          batchTitle: batchPlan.batchTitle,
          batchType: batchPlan.batchType,
          instruction: chatGptInstruction.trim(),
          referenceImageUrl: firstImageUrl || undefined,
          items: batchPlan.items.map((item) => ({
            title: item.title,
            adType: item.adType,
            hook: item.hook,
            promptText: item.promptText,
            caption: item.caption,
            reason: item.reason,
            platform: item.platform,
            durationSeconds: item.durationSeconds,
            aspectRatio: item.aspectRatio,
            resolution: item.resolution,
            model: item.model,
          })),
        }),
      });
      const data = (await res.json()) as {
        batch?: { id: string };
        items?: { id: string }[];
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        const rawMsg = data.detail
          ? `${data.error ?? "Save failed"}: ${data.detail}`
          : (data.error ?? `HTTP ${res.status}`);
        throw new Error(rawMsg);
      }
      if (!data.batch?.id) throw new Error("Save succeeded but batch ID was missing.");
      setSavedBatchData({
        batchId: data.batch.id,
        itemIds: (data.items ?? []).map((it: { id: string }) => it.id),
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setIsSaving(false);
    }
  }, [batchPlan, isSaving, savedBatchData, workspaceKey, brandName, chatGptInstruction, firstImageUrl]);

  // ── Delete batch ──────────────────────────────────────────────────────────────

  const handleDeleteBatch = useCallback(async () => {
    if (!savedBatchData || isDeletingBatch) return;
    if (!confirm("Delete this entire batch and all its concepts? This cannot be undone.")) return;
    setIsDeletingBatch(true);
    setDeleteBatchError("");
    try {
      const res = await fetch(
        `/api/campaign-batches/${encodeURIComponent(savedBatchData.batchId)}`,
        { method: "DELETE" }
      );
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? `Delete failed (HTTP ${res.status})`);
      }
      Object.values(itemTimers.current).forEach(clearTimeout);
      itemTimers.current = {};
      setBatchPlan(null);
      setSavedBatchData(null);
      setDeletedItemIds([]);
      setGenerateError("");
      setSaveError("");
    } catch (err) {
      setDeleteBatchError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setIsDeletingBatch(false);
    }
  }, [savedBatchData, isDeletingBatch]);

  // ── Delete single item ────────────────────────────────────────────────────────

  const handleDeleteItem = useCallback(async (itemId: string) => {
    try {
      await fetch(`/api/campaign-items/${encodeURIComponent(itemId)}`, { method: "DELETE" });
    } catch (err) {
      console.error("[BatchTab] Delete item error:", err);
    } finally {
      setDeletedItemIds((prev) => [...prev, itemId]);
    }
  }, []);

  // ── New Batch — keeps images, clears plan ─────────────────────────────────────

  const handleNewBatch = useCallback(() => {
    Object.values(itemTimers.current).forEach(clearTimeout);
    itemTimers.current = {};
    setBatchPlan(null);
    setGenerateError("");
    setSaveError("");
    setSavedBatchData(null);
    setDeletedItemIds([]);
    setDeleteBatchError("");
    // Images intentionally preserved — user may want a new prompt with the same images.
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">

      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold tracking-widest uppercase text-neutral-600">Batch</span>
          <span className="text-[10px] text-neutral-700">—</span>
          <span className="text-[10px] font-semibold text-neutral-400">{brandName}</span>
        </div>
        <h2 className="text-base font-bold text-white tracking-tight">Reel Batch Generator</h2>
        <p className="text-xs text-neutral-500 leading-relaxed max-w-lg">
          Upload reference images. Tag them. Write a prompt. Generate Seedance 2.0 reels.
        </p>
      </div>

      {/* Main builder card */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-950 overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-800">
          <h3 className="text-sm font-semibold text-white">New Batch</h3>
          <p className="text-xs text-neutral-600 mt-0.5">
            Configure a reel batch for <span className="text-neutral-400">{brandName}</span>.
          </p>
        </div>

        <div className="px-5 py-5 flex flex-col gap-5">

          {/* 1 — Reference Images */}
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-col gap-0.5">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                Reference Images
              </label>
              <p className="text-[10px] text-neutral-700 leading-relaxed">
                Upload products, logos, brand visuals, or models. Each gets a tag like <span className="font-mono text-neutral-500">@product1</span> you can use in your prompt.
              </p>
            </div>

            {/* Uploaded image grid */}
            {referenceImages.length > 0 && (
              <div className="flex flex-col gap-2">
                {referenceImages.map((img, i) => (
                  <ImageCard
                    key={img.id}
                    image={img}
                    index={i}
                    allTags={allTags}
                    onChange={handleTagChange}
                    onRemove={handleRemoveImage}
                  />
                ))}
              </div>
            )}

            {/* Upload button */}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={handleImageUpload}
            />
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={isUploading}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-neutral-700 text-xs text-neutral-500 hover:text-neutral-300 hover:border-neutral-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed w-fit"
            >
              {isUploading ? (
                <>
                  <span
                    className="w-3 h-3 rounded-full animate-spin inline-block"
                    style={{ border: "2px solid transparent", borderTopColor: "#a3e635", borderRightColor: "#22d3ee" }}
                  />
                  Uploading…
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                  {referenceImages.length > 0 ? "+ Add Another Image" : "+ Upload Image"}
                </>
              )}
            </button>

            {uploadError && <p className="text-[11px] text-red-400">{uploadError}</p>}

            {/* URL fallback — collapsed */}
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => setShowUrlFallback((v) => !v)}
                className="flex items-center gap-1 text-[10px] text-neutral-700 hover:text-neutral-500 transition-colors w-fit"
              >
                {showUrlFallback ? "▲" : "▼"} Or paste image URL
              </button>
              {showUrlFallback && (
                <input
                  type="url"
                  value={urlFallbackValue}
                  onChange={(e) => setUrlFallbackValue(e.target.value)}
                  placeholder="https://..."
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-sm text-neutral-200 placeholder-neutral-700 outline-none focus:border-neutral-600 focus:ring-1 focus:ring-neutral-700 transition-colors"
                />
              )}
            </div>
          </div>

          {/* 2 — Seedance Prompt (ChatGPT OFF) */}
          {!useChatGPT && (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                  Seedance Prompt
                </label>
                <p className="text-[10px] text-neutral-700 leading-relaxed">
                  Use image tags like <span className="font-mono text-neutral-500">@product1</span>, <span className="font-mono text-neutral-500">@logo</span>, or <span className="font-mono text-neutral-500">@model1</span> in your prompt.
                </p>
              </div>
              <textarea
                value={seedancePrompt}
                onChange={(e) => setSeedancePrompt(e.target.value)}
                placeholder="Create an 8-second vertical 9:16 reel using @product1 as the exact product reference…"
                rows={4}
                className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-sm text-neutral-200 placeholder-neutral-600 resize-none outline-none focus:border-neutral-600 focus:ring-1 focus:ring-neutral-700 transition-colors leading-relaxed"
              />
            </div>
          )}

          {/* 3 — ChatGPT toggle */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                  Use ChatGPT to create 8 prompts
                </span>
                <p className="text-[10px] text-neutral-700 leading-relaxed max-w-sm">
                  {useChatGPT
                    ? "ChatGPT creates 8 Seedance-ready, platform-neutral prompts. No videos are generated yet."
                    : "When on, ChatGPT creates 8 Seedance-ready reel prompts from your brief and tagged images."}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={useChatGPT}
                onClick={() => { setUseChatGPT((v) => !v); setBatchPlan(null); setGenerateError(""); }}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 cursor-pointer ml-4 ${
                  useChatGPT ? "bg-emerald-500" : "bg-neutral-700"
                }`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200 ${useChatGPT ? "translate-x-4" : "translate-x-1"}`} />
              </button>
            </div>

            {useChatGPT && (
              <div className="flex flex-col gap-4 mt-1 pt-2 border-t border-neutral-800/60">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                    Batch Type
                  </label>
                  <select
                    value={batchType}
                    onChange={(e) => setBatchType(e.target.value)}
                    disabled={isGenerating}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-sm text-neutral-200 outline-none focus:border-neutral-600 focus:ring-1 focus:ring-neutral-700 transition-colors cursor-pointer disabled:opacity-50 [color-scheme:dark]"
                  >
                    {BATCH_TYPES.map((t) => (
                      <option key={t} value={t} className="bg-neutral-900">{t}</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                      Campaign Brief
                    </label>
                    <p className="text-[10px] text-neutral-700 leading-relaxed">
                      Tell ChatGPT what kind of prompts to create. It can use your tagged images like <span className="font-mono text-neutral-500">@product1</span>, <span className="font-mono text-neutral-500">@logo</span>, and <span className="font-mono text-neutral-500">@model1</span>.
                    </p>
                  </div>
                  <textarea
                    value={chatGptInstruction}
                    onChange={(e) => setChatGptInstruction(e.target.value)}
                    disabled={isGenerating}
                    placeholder="Describe the campaign goal, tone, audience, and key message."
                    rows={3}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-sm text-neutral-200 placeholder-neutral-600 resize-none outline-none focus:border-neutral-600 focus:ring-1 focus:ring-neutral-700 transition-colors disabled:opacity-50 leading-relaxed"
                  />
                </div>
              </div>
            )}
          </div>

          {/* 4 — Action button */}
          <div className="flex items-center justify-between pt-1 flex-wrap gap-3">
            {useChatGPT ? (
              <>
                <p className="text-[11px] text-neutral-600 leading-relaxed max-w-xs">
                  ChatGPT creates 8 platform-neutral Seedance prompts. No videos are generated yet.
                </p>
                <button
                  type="button"
                  onClick={handleCreatePrompts}
                  disabled={!canCreatePrompts}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    canCreatePrompts
                      ? "bg-white text-black hover:bg-neutral-200"
                      : "bg-neutral-800 text-neutral-600 cursor-not-allowed opacity-60"
                  }`}
                >
                  {isGenerating ? (
                    <>
                      <span
                        className="w-4 h-4 rounded-full animate-spin inline-block"
                        style={{ border: "2px solid transparent", borderTopColor: "#a3e635", borderRightColor: "#22d3ee" }}
                      />
                      Creating Prompts…
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                      </svg>
                      Create 8 Prompts
                    </>
                  )}
                </button>
              </>
            ) : (
              <>
                <p className="text-[11px] text-neutral-600 leading-relaxed max-w-xs">
                  Direct Seedance generation — coming next step.
                </p>
                <button
                  type="button"
                  disabled
                  title="Single reel generation coming next step"
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-neutral-800 text-neutral-600 cursor-not-allowed opacity-60"
                >
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                  </svg>
                  Generate Reel
                </button>
              </>
            )}
          </div>

        </div>
      </div>

      {/* Generate error */}
      {generateError && (
        <div className="rounded-xl border border-red-900 bg-red-950/30 px-5 py-4">
          <p className="text-xs font-semibold text-red-400 mb-1">Prompt generation failed</p>
          <p className="text-xs text-red-500 leading-relaxed">{generateError}</p>
        </div>
      )}

      {/* ChatGPT results */}
      {batchPlan && (
        <div className="flex flex-col gap-4">

          {/* Results header */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] font-semibold tracking-widest uppercase text-neutral-600">
                {batchPlan.items.filter((_, i) => {
                  const id = savedBatchData?.itemIds[i];
                  return !id || !deletedItemIds.includes(id);
                }).length} / {batchPlan.items.length} Prompts
              </span>
              <h3 className="text-sm font-bold text-white">{batchPlan.batchTitle}</h3>
              <span className="text-[10px] text-neutral-600">
                {batchPlan.batchType} · {brandName}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {!savedBatchData && (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                    isSaving
                      ? "bg-neutral-800 text-neutral-500 cursor-wait"
                      : "bg-white text-black hover:bg-neutral-200"
                  }`}
                >
                  {isSaving ? (
                    <>
                      <span
                        className="w-3.5 h-3.5 rounded-full animate-spin inline-block"
                        style={{ border: "2px solid transparent", borderTopColor: "#a3e635", borderRightColor: "#22d3ee" }}
                      />
                      Saving…
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M7.707 10.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V6h5a2 2 0 012 2v7a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2h5v5.586l-1.293-1.293zM9 4a1 1 0 012 0v2H9V4z" />
                      </svg>
                      Save Batch
                    </>
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={handleNewBatch}
                className="text-xs text-neutral-600 hover:text-neutral-300 transition-colors border border-neutral-800 rounded-lg px-3 py-1.5"
              >
                New Batch
              </button>
            </div>
          </div>

          {/* Save error — with SQL hint */}
          {saveError && (
            <div className="rounded-xl border border-red-900 bg-red-950/30 px-4 py-3 flex flex-col gap-1.5">
              <p className="text-xs font-semibold text-red-400">Save failed</p>
              <p className="text-xs text-red-500 leading-relaxed">{saveError}</p>
              {isSqlMissingError(saveError) && (
                <p className="text-[11px] text-amber-500 leading-relaxed mt-0.5 border-t border-red-900/50 pt-1.5">
                  <strong>SQL required:</strong> Run the <code className="font-mono">campaign_batches</code> and <code className="font-mono">campaign_items</code> migrations in your Supabase SQL editor before saving a batch.
                </p>
              )}
            </div>
          )}

          {/* Batch action bar — shown after save */}
          {savedBatchData && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span className="text-xs font-semibold text-emerald-400">Batch saved · ready to generate</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled
                  title="Video generation coming next step"
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-neutral-800 text-xs font-semibold text-neutral-700 cursor-not-allowed opacity-60"
                >
                  <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                  </svg>
                  Run All Videos
                </button>
                <button
                  type="button"
                  onClick={handleDeleteBatch}
                  disabled={isDeletingBatch}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-neutral-800 text-xs font-semibold text-neutral-500 hover:text-red-400 hover:border-red-900 transition-colors disabled:opacity-50 disabled:cursor-wait"
                >
                  {isDeletingBatch ? (
                    <>
                      <span className="w-2.5 h-2.5 rounded-full animate-spin inline-block"
                        style={{ border: "2px solid transparent", borderTopColor: "#ef4444", borderRightColor: "#ef4444" }} />
                      Deleting…
                    </>
                  ) : (
                    <>
                      <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      Delete Batch
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Delete batch error */}
          {deleteBatchError && (
            <div className="rounded-xl border border-red-900 bg-red-950/30 px-4 py-3">
              <p className="text-xs font-semibold text-red-400 mb-0.5">Delete failed</p>
              <p className="text-xs text-red-500">{deleteBatchError}</p>
            </div>
          )}

          {/* Concept cards grid */}
          {batchPlan.items.some((_, i) => {
            const id = savedBatchData?.itemIds[i];
            return !id || !deletedItemIds.includes(id);
          }) ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {batchPlan.items.map((item, i) => {
                const itemId = savedBatchData?.itemIds[i];
                if (itemId && deletedItemIds.includes(itemId)) return null;
                return (
                  <ConceptCard
                    key={i}
                    item={item}
                    index={i}
                    saved={!!savedBatchData}
                    itemId={itemId}
                    genState={itemId ? itemGenStates[itemId] : undefined}
                    onDelete={handleDeleteItem}
                  />
                );
              })}
            </div>
          ) : savedBatchData ? (
            <div className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/30 px-6 py-10 flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-neutral-600">All concepts deleted.</p>
              <button
                type="button"
                onClick={handleNewBatch}
                className="text-xs text-neutral-500 hover:text-neutral-300 border border-neutral-800 rounded-lg px-3 py-1.5 transition-colors"
              >
                Start New Batch
              </button>
            </div>
          ) : null}

          {!savedBatchData && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 px-5 py-4 flex items-start gap-3">
              <svg className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold text-neutral-300">Review before saving.</span>
                <p className="text-xs text-neutral-500 leading-relaxed">
                  Save the batch to enable per-prompt video generation. Nothing generates or posts yet.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {useChatGPT && !batchPlan && !isGenerating && (
        <div className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/30 px-6 py-10 flex flex-col items-center gap-3 text-center">
          <svg className="w-8 h-8 text-neutral-700" viewBox="0 0 20 20" fill="currentColor">
            <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
          </svg>
          <p className="text-sm text-neutral-600">8 Seedance prompts will appear here.</p>
          <p className="text-xs text-neutral-700 max-w-xs leading-relaxed">
            Upload images, tag them, write a brief, and click Create 8 Prompts.
          </p>
        </div>
      )}

      {/* Safety note */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 px-5 py-4 flex items-start gap-3">
        <svg className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold text-neutral-300">Nothing posts automatically.</span>
          <p className="text-xs text-neutral-500 leading-relaxed">
            Batch videos save to Library for review. Post to any connected platform from there.
          </p>
        </div>
      </div>

    </div>
  );
}
