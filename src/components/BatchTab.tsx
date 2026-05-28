"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { getWorkspaceName, getDefaultPostCaption } from "@/lib/workspaces";

// ─── LocalStorage draft persistence ──────────────────────────────────────────

interface BatchDraft {
  referenceImages?: ReferenceImage[];
  seedancePrompt?: string;
  chatGptInstruction?: string;
  batchType?: string;
  useChatGPT?: boolean;
  includeVoiceover?: boolean;
  batchSize?: number;
  postCaption?: string;
}

// Voiceover defaults to ON only for UGC Ads (mirrors batch-plan/route.ts)
const VOICEOVER_DEFAULT_ON = new Set(["UGC Ads"]);

function draftKey(workspaceKey: string) {
  return `reel_batch_draft:${workspaceKey}`;
}

function loadDraft(workspaceKey: string): BatchDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(draftKey(workspaceKey));
    if (!raw) return null;
    return JSON.parse(raw) as BatchDraft;
  } catch {
    return null;
  }
}

function saveDraft(workspaceKey: string, draft: BatchDraft) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(draftKey(workspaceKey), JSON.stringify(draft));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReferenceImage {
  id: string;
  tag: string;
  name: string;
  url: string;
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
  batchSize: number;
  includeVoiceover: boolean;
  items: BatchItem[];
}

type ItemGenStatus = "idle" | "submitting" | "generating" | "saving" | "done" | "failed";
interface ItemGenState {
  status: ItemGenStatus;
  kieTaskId?: string;
  videoUrl?: string;
  reelId?: string;
  error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 6000;
const MAX_POLLS = 120;

const BATCH_TYPES = ["General Reels", "UGC Ads"] as const;
type BatchType = typeof BATCH_TYPES[number];

const BATCH_TYPE_DESCRIPTIONS: Record<BatchType, string> = {
  "General Reels": "Randomly picks from 12 visual reel formats: hero shots, lifestyle scenes, cinematic reveals, unboxing, problem/solution, fast montage, and more.",
  "UGC Ads":       "Randomly picks from 12 creator-style UGC ad plays: hook + reveal, unboxing, problem/solution, demo, review reaction, 3-reasons-why, objection crusher, and more.",
};

const BATCH_SIZES = [1, 2, 3, 4, 5, 6, 7, 8] as const;

const DEFAULT_TAG_NAMES = [
  "@product1", "@product2", "@logo", "@model1", "@brandcard", "@endcard",
];
function defaultTagForIndex(index: number): string {
  return index < DEFAULT_TAG_NAMES.length ? DEFAULT_TAG_NAMES[index] : `@ref${index + 1}`;
}
function normalizeTag(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  return t.startsWith("@") ? t : `@${t}`;
}
function isSqlMissingError(msg: string): boolean {
  return msg.includes("42P01") || msg.includes("does not exist") || msg.includes("relation") || msg.includes("{}");
}

// ─── Image Card ───────────────────────────────────────────────────────────────

function ImageCard({ image, index, allTags, onChange, onRemove }: {
  image: ReferenceImage;
  index: number;
  allTags: string[];
  onChange: (id: string, tag: string) => void;
  onRemove: (id: string) => void;
}) {
  const [tagInput, setTagInput] = useState(image.tag);
  const [tagError, setTagError] = useState("");

  const commit = () => {
    const n = normalizeTag(tagInput);
    if (!n) { setTagInput(image.tag); setTagError(""); return; }
    const others = allTags.filter((_, i) => i !== index);
    if (others.includes(n)) { setTagError("Duplicate tag"); return; }
    setTagError("");
    setTagInput(n);
    onChange(image.id, n);
  };

  return (
    <div className="flex items-start gap-2.5 p-2.5 rounded-xl border border-neutral-800 bg-neutral-900/60">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.url} alt={image.name} className="w-12 h-12 rounded-lg object-cover flex-shrink-0 border border-neutral-700" />
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <p className="text-[10px] font-medium text-neutral-300 truncate">{image.name}</p>
        <div className="flex flex-col gap-0.5">
          <input
            type="text"
            value={tagInput}
            onChange={(e) => { setTagInput(e.target.value); setTagError(""); }}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className={`w-full bg-neutral-800 border rounded-lg px-2 py-1 text-[11px] font-mono text-neutral-200 outline-none transition-colors ${tagError ? "border-red-800" : "border-neutral-700 focus:border-neutral-500"}`}
            placeholder="@tag"
          />
          {tagError && <p className="text-[10px] text-red-400">{tagError}</p>}
        </div>
      </div>
      <button type="button" onClick={() => onRemove(image.id)} title="Remove" className="w-6 h-6 flex items-center justify-center rounded-md border border-neutral-700 text-neutral-600 hover:text-red-400 hover:border-red-900 transition-colors mt-0.5">×</button>
    </div>
  );
}

// ─── Concept Card ─────────────────────────────────────────────────────────────

function ConceptCard({ item, index, saved, itemId, genState, includeVoiceover, onGenerate, onDelete }: {
  item: BatchItem;
  index: number;
  saved: boolean;
  itemId?: string;
  genState?: ItemGenState;
  includeVoiceover?: boolean;
  onGenerate?: (itemId: string) => void;
  onDelete?: (itemId: string) => void;
}) {
  const [promptOpen, setPromptOpen] = useState(false);
  const [captionOpen, setCaptionOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = useCallback(() => {
    if (!itemId || isDeleting) return;
    if (!confirm("Delete this concept?")) return;
    setIsDeleting(true);
    onDelete?.(itemId);
  }, [itemId, isDeleting, onDelete]);

  const gs = genState;
  const gsStatus = gs?.status ?? "idle";
  const isRunning = gsStatus === "submitting" || gsStatus === "generating" || gsStatus === "saving";

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950 overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-800 flex items-start gap-3 bg-neutral-900/40">
        <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5"
          style={{ background: "linear-gradient(135deg, #a3e635, #22d3ee)", color: "#000" }}>
          {index + 1}
        </span>
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <span className="text-sm font-semibold text-white leading-tight">{item.title}</span>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-700 text-neutral-400">{item.adType}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-800 text-neutral-600">{item.durationSeconds}s · {item.aspectRatio}</span>
            {includeVoiceover && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-sky-900 text-sky-500">Talking / VO</span>
            )}
            {saved
              ? gsStatus === "done"
                ? <span className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-900 text-emerald-500">Saved to Library ✓</span>
                : gsStatus === "failed"
                ? <span className="text-[10px] px-1.5 py-0.5 rounded border border-red-900 text-red-500">Failed</span>
                : isRunning
                ? <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-900 text-amber-500">
                    {gsStatus === "submitting" ? "Submitting…" : gsStatus === "saving" ? "Saving…" : "Generating…"}
                  </span>
                : <span className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-900 text-emerald-500">Saved</span>
              : <span className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-800 text-neutral-600">Draft</span>
            }
          </div>
        </div>

        {/* Controls — only after save */}
        {saved && itemId && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Generate Video */}
            {gsStatus === "done" ? (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 px-2.5 py-1.5 rounded-lg border border-emerald-900">
                <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Done
              </span>
            ) : gsStatus === "failed" ? (
              <button type="button" onClick={() => onGenerate?.(itemId)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-red-900 text-[11px] font-medium text-red-400 hover:text-red-300 transition-colors">
                Retry
              </button>
            ) : (
              <button type="button"
                onClick={() => !isRunning && onGenerate?.(itemId)}
                disabled={isRunning}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors flex-shrink-0 ${
                  isRunning
                    ? "border-neutral-800 text-neutral-600 cursor-wait"
                    : "border-neutral-600 text-neutral-300 hover:text-white hover:border-neutral-400"
                }`}
              >
                {isRunning ? (
                  <>
                    <span className="w-2.5 h-2.5 rounded-full animate-spin inline-block"
                      style={{ border: "2px solid transparent", borderTopColor: "#a3e635", borderRightColor: "#22d3ee" }} />
                    {gsStatus === "submitting" ? "Starting…" : gsStatus === "saving" ? "Saving…" : "Generating…"}
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                    </svg>
                    Generate Video
                  </>
                )}
              </button>
            )}

            {/* Delete */}
            <button type="button" onClick={handleDelete} disabled={isDeleting || isRunning}
              className="w-7 h-7 flex items-center justify-center rounded-lg border border-neutral-800 text-neutral-600 hover:text-red-400 hover:border-red-900 transition-colors disabled:opacity-40">
              <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <div className="px-4 py-4 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-600">Hook</span>
          <p className="text-xs text-neutral-300 leading-relaxed">{item.hook}</p>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-600">Why it works</span>
          <p className="text-xs text-neutral-500 leading-relaxed">{item.reason}</p>
        </div>
        <div className="flex flex-col gap-1">
          <button type="button" onClick={() => setCaptionOpen(v => !v)}
            className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-600 hover:text-neutral-400 transition-colors w-fit">
            Post Caption
            <svg className={`w-2.5 h-2.5 transition-transform ${captionOpen ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          {captionOpen && (
            <div className="flex flex-col gap-1">
              <p className="text-[10px] text-neutral-700">For posting only — not used inside the video.</p>
              <p className="text-xs text-neutral-500 leading-relaxed whitespace-pre-wrap">{item.caption}</p>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <button type="button" onClick={() => setPromptOpen(v => !v)}
            className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-600 hover:text-neutral-400 transition-colors w-fit">
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: "linear-gradient(135deg, #a3e635, #22d3ee)" }} />
            Seedance Prompt
            <svg className={`w-2.5 h-2.5 transition-transform ${promptOpen ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          {promptOpen && <p className="text-xs text-neutral-400 leading-relaxed bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 font-mono">{item.promptText}</p>}
        </div>

        {/* Inline generation status */}
        {gs && gsStatus !== "idle" && (
          <div className="mt-1">
            {isRunning && (
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                <span className="w-2.5 h-2.5 rounded-full animate-spin inline-block"
                  style={{ border: "2px solid transparent", borderTopColor: "#a3e635", borderRightColor: "#22d3ee" }} />
                {gsStatus === "submitting" && "Submitting to Kie.ai…"}
                {gsStatus === "generating" && `Generating… (${gs.kieTaskId?.slice(0, 8)}…)`}
                {gsStatus === "saving" && "Saving to Library…"}
              </div>
            )}
            {gsStatus === "failed" && gs.error && (
              <p className="text-[11px] text-red-400 leading-relaxed">{gs.error}</p>
            )}
            {gsStatus === "done" && gs.videoUrl && (
              <a href={gs.videoUrl} target="_blank" rel="noopener noreferrer"
                className="text-[11px] text-emerald-400 hover:text-emerald-300 underline underline-offset-2">
                View raw video ↗
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
  onSwitchToLibrary?: () => void;
}

export default function BatchTab({ workspaceKey = "gotjesus", onSwitchToLibrary }: Props) {
  const brandName = getWorkspaceName(workspaceKey);

  // ── Reference images ─────────────────────────────────────────────────────────
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [showUrlFallback, setShowUrlFallback] = useState(false);
  const [urlFallbackValue, setUrlFallbackValue] = useState("");
  const imageInputRef = useRef<HTMLInputElement>(null);

  // ── Mode ──────────────────────────────────────────────────────────────────────
  const [useChatGPT, setUseChatGPT] = useState(false);
  const [seedancePrompt, setSeedancePrompt] = useState(
    "Create an 8-second vertical 9:16 reel using @product1 as the exact product reference. Make it cinematic, fast-paced, and social-media ready."
  );
  const [chatGptInstruction, setChatGptInstruction] = useState(
    "Make every type of short-form ad this brand would actually need."
  );
  const [batchType, setBatchType] = useState<string>(BATCH_TYPES[0]);
  const [batchSize, setBatchSize] = useState(4);
  const [includeVoiceover, setIncludeVoiceover] = useState(false); // loaded from draft or batchType default
  const [postCaption, setPostCaption] = useState(() => getDefaultPostCaption(workspaceKey));

  // Auto-update voiceover default when batch type changes (unless user already has a draft)
  const voiceoverUserOverride = useRef(false);
  const handleBatchTypeChange = useCallback((type: string) => {
    setBatchType(type);
    if (!voiceoverUserOverride.current) {
      setIncludeVoiceover(VOICEOVER_DEFAULT_ON.has(type));
    }
  }, []);

  // ── Batch plan ───────────────────────────────────────────────────────────────
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [batchPlan, setBatchPlan] = useState<BatchPlanResponse | null>(null);

  // ── Save state ────────────────────────────────────────────────────────────────
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedBatchData, setSavedBatchData] = useState<{ batchId: string; itemIds: string[] } | null>(null);

  // ── Delete state ──────────────────────────────────────────────────────────────
  const [isDeletingBatch, setIsDeletingBatch] = useState(false);
  const [deleteBatchError, setDeleteBatchError] = useState("");
  const [deletedItemIds, setDeletedItemIds] = useState<string[]>([]);

  // ── Per-item generation ───────────────────────────────────────────────────────
  const [itemGenStates, setItemGenStates] = useState<Record<string, ItemGenState>>({});
  const itemTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const itemPollCounts = useRef<Record<string, number>>({});

  // ── Run All state ─────────────────────────────────────────────────────────────
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [runAllProgress, setRunAllProgress] = useState<{ done: number; total: number } | null>(null);
  const runAllCancelRef = useRef(false);

  // ── Draft persistence: load from localStorage on mount / workspace switch ────
  const draftLoadedRef = useRef<string | null>(null);
  useEffect(() => {
    if (draftLoadedRef.current === workspaceKey) return; // already loaded for this workspace
    draftLoadedRef.current = workspaceKey;
    const draft = loadDraft(workspaceKey);
    if (!draft) return;
    if (Array.isArray(draft.referenceImages) && draft.referenceImages.length > 0) {
      setReferenceImages(draft.referenceImages);
    }
    if (typeof draft.seedancePrompt === "string" && draft.seedancePrompt) {
      setSeedancePrompt(draft.seedancePrompt);
    }
    if (typeof draft.chatGptInstruction === "string" && draft.chatGptInstruction) {
      setChatGptInstruction(draft.chatGptInstruction);
    }
    if (typeof draft.batchType === "string" && draft.batchType) {
      setBatchType(draft.batchType);
    }
    if (typeof draft.useChatGPT === "boolean") {
      setUseChatGPT(draft.useChatGPT);
    }
    if (typeof draft.includeVoiceover === "boolean") {
      setIncludeVoiceover(draft.includeVoiceover);
      voiceoverUserOverride.current = true;
    } else {
      const loadedType = draft.batchType ?? BATCH_TYPES[0];
      setIncludeVoiceover(VOICEOVER_DEFAULT_ON.has(loadedType));
    }
    if (typeof draft.batchSize === "number" && draft.batchSize >= 1 && draft.batchSize <= 8) {
      setBatchSize(draft.batchSize);
    }
    if (typeof draft.postCaption === "string") {
      setPostCaption(draft.postCaption);
    } else {
      setPostCaption(getDefaultPostCaption(workspaceKey));
    }
  }, [workspaceKey]);

  // ── Draft persistence: auto-save whenever relevant state changes ──────────
  useEffect(() => {
    saveDraft(workspaceKey, { referenceImages, seedancePrompt, chatGptInstruction, batchType, useChatGPT, includeVoiceover, batchSize, postCaption });
  }, [workspaceKey, referenceImages, seedancePrompt, chatGptInstruction, batchType, useChatGPT, includeVoiceover, batchSize, postCaption]);

  // Cleanup on unmount
  useEffect(() => {
    const timers = itemTimers.current;
    return () => { Object.values(timers).forEach(clearTimeout); };
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────────────
  const firstImageUrl = referenceImages[0]?.url ?? urlFallbackValue.trim() ?? "";
  const allTags = referenceImages.map(img => img.tag);
  const anyDone = Object.values(itemGenStates).some(s => s.status === "done");

  // ── Image upload ──────────────────────────────────────────────────────────────

  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    e.target.value = "";
    setIsUploading(true);
    setUploadError("");
    const startIndex = referenceImages.length;
    const newImages: ReferenceImage[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("workspaceKey", workspaceKey);
        const res = await fetch("/api/campaign-batches/upload", { method: "POST", body: form });
        const data = (await res.json()) as { url?: string; name?: string; error?: string };
        if (!res.ok || !data.url) throw new Error(data.error ?? "Upload failed.");
        newImages.push({ id: `img-${Date.now()}-${i}`, tag: defaultTagForIndex(startIndex + newImages.length), name: data.name ?? file.name, url: data.url });
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Upload failed.");
      }
    }
    if (newImages.length > 0) { setReferenceImages(prev => [...prev, ...newImages]); setShowUrlFallback(false); }
    setIsUploading(false);
  }, [workspaceKey, referenceImages.length]);

  const handleTagChange = useCallback((id: string, tag: string) => {
    setReferenceImages(prev => prev.map(img => img.id === id ? { ...img, tag } : img));
  }, []);

  const handleRemoveImage = useCallback((id: string) => {
    setReferenceImages(prev => prev.filter(img => img.id !== id));
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
    setItemGenStates({});
    try {
      const res = await fetch("/api/batch-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceKey, brandName,
          instruction: chatGptInstruction.trim(), batchType,
          referenceImages: referenceImages.map(({ tag, name, url }) => ({ tag, name, url })),
          referenceImageUrl: firstImageUrl || undefined,
          batchSize,
          includeVoiceover,
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
          workspaceKey, brandName,
          batchTitle: batchPlan.batchTitle, batchType: batchPlan.batchType,
          instruction: chatGptInstruction.trim(), referenceImageUrl: firstImageUrl || undefined,
          postCaption: postCaption.trim() || undefined,
          items: batchPlan.items.map(item => ({
            title: item.title, adType: item.adType, hook: item.hook, promptText: item.promptText,
            caption: item.caption, reason: item.reason, platform: item.platform,
            durationSeconds: item.durationSeconds, aspectRatio: item.aspectRatio,
            resolution: item.resolution, model: item.model,
          })),
        }),
      });
      const data = (await res.json()) as { batch?: { id: string }; items?: { id: string }[]; error?: string; detail?: string };
      if (!res.ok) {
        const msg = data.detail ? `${data.error ?? "Save failed"}: ${data.detail}` : (data.error ?? `HTTP ${res.status}`);
        throw new Error(msg);
      }
      if (!data.batch?.id) throw new Error("Save succeeded but batch ID was missing.");
      setSavedBatchData({ batchId: data.batch.id, itemIds: (data.items ?? []).map(it => it.id) });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setIsSaving(false);
    }
  }, [batchPlan, isSaving, savedBatchData, workspaceKey, brandName, chatGptInstruction, firstImageUrl]);

  // ── Per-item generation ───────────────────────────────────────────────────────

  const stopItemPoll = useCallback((itemId: string) => {
    if (itemTimers.current[itemId]) { clearTimeout(itemTimers.current[itemId]); delete itemTimers.current[itemId]; }
  }, []);

  const saveItemToLibrary = useCallback(async (itemId: string, kieVideoUrl: string, kieTaskId: string) => {
    try {
      const res = await fetch(`/api/campaign-items/${encodeURIComponent(itemId)}/save-to-library`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kieVideoUrl, kieTaskId }),
      });
      const data = (await res.json()) as { reelId?: string; error?: string };
      setItemGenStates(prev => ({ ...prev, [itemId]: { status: "done", kieTaskId, videoUrl: kieVideoUrl, reelId: data.reelId } }));
    } catch {
      // Still mark done — video exists
      setItemGenStates(prev => ({ ...prev, [itemId]: { status: "done", kieTaskId, videoUrl: kieVideoUrl } }));
    }
  }, []);

  // Defined via ref to allow self-reference in setTimeout without stale closure issues
  const pollItemRef = useRef<((itemId: string, taskId: string) => void) | null>(null);
  pollItemRef.current = (itemId: string, taskId: string) => {
    if ((itemPollCounts.current[itemId] ?? 0) >= MAX_POLLS) {
      stopItemPoll(itemId);
      setItemGenStates(prev => ({ ...prev, [itemId]: { ...prev[itemId], status: "failed", error: "Generation timed out." } }));
      return;
    }
    itemPollCounts.current[itemId] = (itemPollCounts.current[itemId] ?? 0) + 1;

    fetch(`/api/generate-video?taskId=${encodeURIComponent(taskId)}`)
      .then(r => r.json() as Promise<{ state?: string; videoUrl?: string | null; failMsg?: string | null; error?: string }>)
      .then(data => {
        if (data.error) {
          stopItemPoll(itemId);
          setItemGenStates(prev => ({ ...prev, [itemId]: { ...prev[itemId], status: "failed", error: data.error } }));
          return;
        }
        const state = data.state ?? "waiting";
        if (state === "success" && data.videoUrl) {
          stopItemPoll(itemId);
          setItemGenStates(prev => ({ ...prev, [itemId]: { ...prev[itemId], status: "saving", videoUrl: data.videoUrl! } }));
          void saveItemToLibrary(itemId, data.videoUrl!, taskId);
          return;
        }
        if (state === "fail") {
          stopItemPoll(itemId);
          setItemGenStates(prev => ({ ...prev, [itemId]: { ...prev[itemId], status: "failed", error: data.failMsg ?? "Kie generation failed." } }));
          return;
        }
        itemTimers.current[itemId] = setTimeout(() => pollItemRef.current?.(itemId, taskId), POLL_INTERVAL_MS);
      })
      .catch(err => {
        stopItemPoll(itemId);
        setItemGenStates(prev => ({ ...prev, [itemId]: { ...prev[itemId], status: "failed", error: err instanceof Error ? err.message : "Poll error." } }));
      });
  };

  const handleGenerateItem = useCallback(async (itemId: string) => {
    const current = itemGenStates[itemId]?.status;
    if (current === "submitting" || current === "generating" || current === "saving" || current === "done") return;
    setItemGenStates(prev => ({ ...prev, [itemId]: { status: "submitting" } }));
    stopItemPoll(itemId);
    itemPollCounts.current[itemId] = 0;
    try {
      const res = await fetch(`/api/campaign-items/${encodeURIComponent(itemId)}/generate`, { method: "POST" });
      const data = (await res.json()) as { kieTaskId?: string; error?: string; status?: string };
      if (!res.ok) {
        if (res.status === 409 && data.status === "done") {
          setItemGenStates(prev => ({ ...prev, [itemId]: { status: "done", videoUrl: undefined } }));
          return;
        }
        setItemGenStates(prev => ({ ...prev, [itemId]: { status: "failed", error: data.error ?? "Failed to start." } }));
        return;
      }
      if (!data.kieTaskId) {
        setItemGenStates(prev => ({ ...prev, [itemId]: { status: "failed", error: "No task ID returned." } }));
        return;
      }
      setItemGenStates(prev => ({ ...prev, [itemId]: { status: "generating", kieTaskId: data.kieTaskId } }));
      itemTimers.current[itemId] = setTimeout(() => pollItemRef.current?.(itemId, data.kieTaskId!), POLL_INTERVAL_MS);
    } catch (err) {
      setItemGenStates(prev => ({ ...prev, [itemId]: { status: "failed", error: err instanceof Error ? err.message : "Submit error." } }));
    }
  }, [itemGenStates, stopItemPoll]);

  // ── Run All Videos (sequential) ───────────────────────────────────────────────

  const handleRunAll = useCallback(async () => {
    if (!savedBatchData || isRunningAll) return;
    const pending = savedBatchData.itemIds.filter((id, i) => {
      if (!id) return false;
      if (deletedItemIds.includes(id)) return false;
      const st = itemGenStates[id]?.status;
      return st !== "done" && st !== "generating" && st !== "saving" && st !== "submitting";
    });
    if (pending.length === 0) return;
    setIsRunningAll(true);
    runAllCancelRef.current = false;
    setRunAllProgress({ done: 0, total: pending.length });

    for (let i = 0; i < pending.length; i++) {
      if (runAllCancelRef.current) break;
      const itemId = pending[i];

      // Submit generation
      setItemGenStates(prev => ({ ...prev, [itemId]: { status: "submitting" } }));
      itemPollCounts.current[itemId] = 0;

      let taskId: string | null = null;
      try {
        const res = await fetch(`/api/campaign-items/${encodeURIComponent(itemId)}/generate`, { method: "POST" });
        const data = (await res.json()) as { kieTaskId?: string; error?: string; status?: string };
        if (!res.ok || !data.kieTaskId) {
          setItemGenStates(prev => ({ ...prev, [itemId]: { status: "failed", error: data.error ?? "Submit failed." } }));
          setRunAllProgress(prev => prev ? { ...prev, done: prev.done + 1 } : null);
          continue;
        }
        taskId = data.kieTaskId;
        setItemGenStates(prev => ({ ...prev, [itemId]: { status: "generating", kieTaskId: taskId! } }));
      } catch (err) {
        setItemGenStates(prev => ({ ...prev, [itemId]: { status: "failed", error: err instanceof Error ? err.message : "Submit error." } }));
        setRunAllProgress(prev => prev ? { ...prev, done: prev.done + 1 } : null);
        continue;
      }

      // Poll until done (blocking — one at a time)
      let polls = 0;
      let videoUrl: string | null = null;
      outer: while (polls < MAX_POLLS) {
        if (runAllCancelRef.current) break;
        await new Promise<void>(r => { itemTimers.current[`runall-${itemId}`] = setTimeout(r, POLL_INTERVAL_MS); });
        polls++;
        try {
          const pr = await fetch(`/api/generate-video?taskId=${encodeURIComponent(taskId!)}`);
          const pd = (await pr.json()) as { state?: string; videoUrl?: string | null; failMsg?: string | null; error?: string };
          if (pd.error) {
            setItemGenStates(prev => ({ ...prev, [itemId]: { ...prev[itemId], status: "failed", error: pd.error } }));
            break;
          }
          if (pd.state === "success" && pd.videoUrl) { videoUrl = pd.videoUrl; break outer; }
          if (pd.state === "fail") {
            setItemGenStates(prev => ({ ...prev, [itemId]: { ...prev[itemId], status: "failed", error: pd.failMsg ?? "Kie failed." } }));
            break;
          }
        } catch { /* keep polling */ }
      }
      if (polls >= MAX_POLLS) {
        setItemGenStates(prev => ({ ...prev, [itemId]: { ...prev[itemId], status: "failed", error: "Timed out." } }));
      }

      if (videoUrl) {
        setItemGenStates(prev => ({ ...prev, [itemId]: { ...prev[itemId], status: "saving", videoUrl } }));
        await saveItemToLibrary(itemId, videoUrl, taskId!);
      }

      setRunAllProgress(prev => prev ? { ...prev, done: prev.done + 1 } : null);
    }

    setIsRunningAll(false);
    setRunAllProgress(null);
  }, [savedBatchData, isRunningAll, deletedItemIds, itemGenStates, saveItemToLibrary]);

  // ── Delete batch ──────────────────────────────────────────────────────────────

  const handleDeleteBatch = useCallback(async () => {
    if (!savedBatchData || isDeletingBatch) return;
    if (!confirm("Delete this entire batch and all its concepts?")) return;
    setIsDeletingBatch(true);
    setDeleteBatchError("");
    try {
      const res = await fetch(`/api/campaign-batches/${encodeURIComponent(savedBatchData.batchId)}`, { method: "DELETE" });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error ?? "Delete failed.");
      Object.values(itemTimers.current).forEach(clearTimeout);
      itemTimers.current = {};
      setBatchPlan(null); setSavedBatchData(null); setDeletedItemIds([]);
      setItemGenStates({}); setGenerateError(""); setSaveError("");
    } catch (err) {
      setDeleteBatchError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setIsDeletingBatch(false);
    }
  }, [savedBatchData, isDeletingBatch]);

  // ── Delete single item ────────────────────────────────────────────────────────

  const handleDeleteItem = useCallback(async (itemId: string) => {
    try { await fetch(`/api/campaign-items/${encodeURIComponent(itemId)}`, { method: "DELETE" }); }
    catch { /* ignore */ }
    setDeletedItemIds(prev => [...prev, itemId]);
  }, []);

  // ── New Batch — keeps images ──────────────────────────────────────────────────

  const handleNewBatch = useCallback(() => {
    Object.values(itemTimers.current).forEach(clearTimeout);
    itemTimers.current = {};
    setBatchPlan(null); setGenerateError(""); setSaveError("");
    setSavedBatchData(null); setDeletedItemIds([]); setItemGenStates({});
    setDeleteBatchError("");
    setIsRunningAll(false); setRunAllProgress(null);
    runAllCancelRef.current = true;
    // Reference images are intentionally kept — user may want a new prompt on same product
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Clear Images ──────────────────────────────────────────────────────────────

  const handleClearImages = useCallback(() => {
    if (!confirm("Remove all uploaded images from this workspace draft?")) return;
    setReferenceImages([]);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────────

  const completeCount = Object.values(itemGenStates).filter(s => s.status === "done").length;
  const visibleCount = batchPlan
    ? batchPlan.items.filter((_, i) => {
        const id = savedBatchData?.itemIds[i];
        return !id || !deletedItemIds.includes(id);
      }).length
    : 0;

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
          <p className="text-xs text-neutral-600 mt-0.5">Configure a reel batch for <span className="text-neutral-400">{brandName}</span>.</p>
        </div>
        <div className="px-5 py-5 flex flex-col gap-5">

          {/* Reference Images */}
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-col gap-0.5">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">Reference Images</label>
              <p className="text-[10px] text-neutral-700">Upload products, logos, brand visuals, or models. Tag each one like <span className="font-mono text-neutral-500">@product1</span>.</p>
            </div>
            {referenceImages.length > 0 && (
              <div className="flex flex-col gap-2">
                {referenceImages.map((img, i) => (
                  <ImageCard key={img.id} image={img} index={i} allTags={allTags} onChange={handleTagChange} onRemove={handleRemoveImage} />
                ))}
              </div>
            )}
            <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={handleImageUpload} />
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={() => imageInputRef.current?.click()} disabled={isUploading}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-neutral-700 text-xs text-neutral-500 hover:text-neutral-300 hover:border-neutral-500 transition-colors disabled:opacity-50">
                {isUploading
                  ? <><span className="w-3 h-3 rounded-full animate-spin" style={{ border: "2px solid transparent", borderTopColor: "#a3e635", borderRightColor: "#22d3ee" }} />Uploading…</>
                  : <><svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
                    {referenceImages.length > 0 ? "+ Add Another Image" : "+ Upload Image"}</>
                }
              </button>
              {referenceImages.length > 0 && (
                <button type="button" onClick={handleClearImages}
                  className="text-[11px] text-neutral-700 hover:text-red-400 transition-colors border border-neutral-800 rounded-lg px-2.5 py-1.5">
                  Clear Images
                </button>
              )}
            </div>
            {uploadError && <p className="text-[11px] text-red-400">{uploadError}</p>}
            <div className="flex flex-col gap-1.5">
              <button type="button" onClick={() => setShowUrlFallback(v => !v)} className="flex items-center gap-1 text-[10px] text-neutral-700 hover:text-neutral-500 transition-colors w-fit">
                {showUrlFallback ? "▲" : "▼"} Or paste image URL
              </button>
              {showUrlFallback && (
                <input type="url" value={urlFallbackValue} onChange={e => setUrlFallbackValue(e.target.value)} placeholder="https://…"
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-sm text-neutral-200 placeholder-neutral-700 outline-none focus:border-neutral-600 transition-colors" />
              )}
            </div>
          </div>

          {/* Seedance Prompt (ChatGPT OFF) */}
          {!useChatGPT && (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">Seedance Prompt</label>
                <p className="text-[10px] text-neutral-700">Use tags like <span className="font-mono text-neutral-500">@product1</span>, <span className="font-mono text-neutral-500">@logo</span>, or <span className="font-mono text-neutral-500">@model1</span> in your prompt.</p>
              </div>
              <textarea value={seedancePrompt} onChange={e => setSeedancePrompt(e.target.value)} rows={4}
                placeholder="Create an 8-second vertical 9:16 reel using @product1 as the exact product reference…"
                className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-sm text-neutral-200 placeholder-neutral-600 resize-none outline-none focus:border-neutral-600 transition-colors leading-relaxed" />
            </div>
          )}

          {/* ChatGPT toggle */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">Use ChatGPT to create 8 prompts</span>
                <p className="text-[10px] text-neutral-700 max-w-sm">
                  {useChatGPT ? `ChatGPT creates ${batchSize} platform-neutral Seedance prompts. No videos generated yet.` : `Turn on to generate ${batchSize} Seedance-ready prompts from your brief and tagged images.`}
                </p>
              </div>
              <button type="button" role="switch" aria-checked={useChatGPT}
                onClick={() => { setUseChatGPT(v => !v); setBatchPlan(null); setGenerateError(""); }}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 cursor-pointer ml-4 ${useChatGPT ? "bg-emerald-500" : "bg-neutral-700"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200 ${useChatGPT ? "translate-x-4" : "translate-x-1"}`} />
              </button>
            </div>
            {useChatGPT && (
              <div className="flex flex-col gap-4 mt-1 pt-2 border-t border-neutral-800/60">
                <div className="grid grid-cols-2 gap-3">
                  {/* Batch Type */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">Creative Mode</label>
                    <select value={batchType} onChange={e => handleBatchTypeChange(e.target.value)} disabled={isGenerating}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2.5 text-sm text-neutral-200 outline-none focus:border-neutral-600 cursor-pointer disabled:opacity-50 [color-scheme:dark]">
                      {BATCH_TYPES.map(t => <option key={t} value={t} className="bg-neutral-900">{t}</option>)}
                    </select>
                    {(BATCH_TYPE_DESCRIPTIONS as Record<string, string>)[batchType] && (
                      <p className="text-[10px] text-neutral-600 leading-relaxed">{(BATCH_TYPE_DESCRIPTIONS as Record<string, string>)[batchType]}</p>
                    )}
                  </div>
                  {/* Batch Size */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">Number of Videos</label>
                    <select value={batchSize} onChange={e => setBatchSize(Number(e.target.value))} disabled={isGenerating}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2.5 text-sm text-neutral-200 outline-none focus:border-neutral-600 cursor-pointer disabled:opacity-50 [color-scheme:dark]">
                      {BATCH_SIZES.map(n => <option key={n} value={n} className="bg-neutral-900">{n} {n === 1 ? "video" : "videos"}</option>)}
                    </select>
                    <p className="text-[10px] text-neutral-600 leading-relaxed">
                      {batchSize <= 3 ? "Quick test batch." : batchSize <= 6 ? "Solid campaign batch." : "Full 8-video campaign."}
                    </p>
                  </div>
                </div>

                {/* Voiceover toggle */}
                <div className="flex items-center justify-between gap-3 py-3 border-t border-neutral-800/60">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">Include Talking / Voiceover</span>
                    <p className="text-[10px] text-neutral-700 max-w-xs">
                      {includeVoiceover
                        ? "Prompts include spoken hook, product line, and CTA. Creator speaks naturally on camera."
                        : "Visual-only prompts. No spoken lines. Ambient audio or music only."}
                    </p>
                  </div>
                  <button type="button" role="switch" aria-checked={includeVoiceover}
                    onClick={() => { voiceoverUserOverride.current = true; setIncludeVoiceover(v => !v); }}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 cursor-pointer ml-2 ${includeVoiceover ? "bg-sky-500" : "bg-neutral-700"}`}>
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200 ${includeVoiceover ? "translate-x-4" : "translate-x-1"}`} />
                  </button>
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">Campaign Brief</label>
                    <p className="text-[10px] text-neutral-700">Tell ChatGPT what kind of prompts to create. Use tags like <span className="font-mono text-neutral-500">@product1</span> and <span className="font-mono text-neutral-500">@logo</span>.</p>
                    {referenceImages.length > 0 && (
                      <p className="text-[10px] text-emerald-700 mt-0.5">
                        GPT will use your image tags&nbsp;
                        <span className="font-mono">{referenceImages.map(i => i.tag).join(", ")}</span>
                        &nbsp;inside every Seedance prompt.
                      </p>
                    )}
                  </div>
                  <textarea value={chatGptInstruction} onChange={e => setChatGptInstruction(e.target.value)} disabled={isGenerating} rows={3}
                    placeholder="Describe the campaign goal, tone, audience, and key message."
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-sm text-neutral-200 placeholder-neutral-600 resize-none outline-none focus:border-neutral-600 transition-colors disabled:opacity-50 leading-relaxed" />
                </div>
              </div>
            )}
          </div>

          {/* Post Caption */}
          <div className="flex flex-col gap-1.5 pt-1 border-t border-neutral-800/60">
            <div className="flex flex-col gap-0.5">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">Post Caption for Library</label>
              <p className="text-[10px] text-neutral-700">Used when videos are saved to Library and posted later. Not added inside the video.</p>
            </div>
            <textarea
              value={postCaption}
              onChange={e => setPostCaption(e.target.value)}
              rows={2}
              placeholder="Write the caption and hashtags for this batch..."
              className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-2 text-xs text-neutral-300 placeholder-neutral-700 resize-none outline-none focus:border-neutral-600 focus:ring-1 focus:ring-neutral-700 transition-colors leading-relaxed"
            />
          </div>

          {/* Action button */}
          <div className="flex items-center justify-between pt-1 flex-wrap gap-3">
            {useChatGPT ? (
              <>
                <p className="text-[11px] text-neutral-600 max-w-xs">ChatGPT creates {batchSize} platform-neutral Seedance prompts. No videos generated yet.</p>
                <button type="button" onClick={handleCreatePrompts} disabled={!canCreatePrompts}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${canCreatePrompts ? "bg-white text-black hover:bg-neutral-200" : "bg-neutral-800 text-neutral-600 cursor-not-allowed opacity-60"}`}>
                  {isGenerating
                    ? <><span className="w-4 h-4 rounded-full animate-spin" style={{ border: "2px solid transparent", borderTopColor: "#a3e635", borderRightColor: "#22d3ee" }} />Creating {batchSize} {batchSize === 1 ? "Prompt" : "Prompts"}…</>
                    : <><svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" /></svg>Create {batchSize} {batchSize === 1 ? "Prompt" : "Prompts"}</>
                  }
                </button>
              </>
            ) : (
              <>
                <p className="text-[11px] text-neutral-600 max-w-xs">Direct Seedance generation — coming in a future step.</p>
                <button type="button" disabled className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-neutral-800 text-neutral-600 cursor-not-allowed opacity-60">
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>
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
          <p className="text-xs text-red-500">{generateError}</p>
        </div>
      )}

      {/* Batch results */}
      {batchPlan && (
        <div className="flex flex-col gap-4">

          {/* Results header */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] font-semibold tracking-widest uppercase text-neutral-600">
                {visibleCount} / {batchPlan.items.length} {batchPlan.items.length === 1 ? "Prompt" : "Prompts"} Ready
              </span>
              <h3 className="text-sm font-bold text-white">{batchPlan.batchTitle}</h3>
              <span className="text-[10px] text-neutral-600">{batchPlan.batchType} · {brandName}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {!savedBatchData && (
                <button type="button" onClick={handleSave} disabled={isSaving}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${isSaving ? "bg-neutral-800 text-neutral-500 cursor-wait" : "bg-white text-black hover:bg-neutral-200"}`}>
                  {isSaving
                    ? <><span className="w-3.5 h-3.5 rounded-full animate-spin" style={{ border: "2px solid transparent", borderTopColor: "#a3e635", borderRightColor: "#22d3ee" }} />Saving…</>
                    : <><svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M7.707 10.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V6h5a2 2 0 012 2v7a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2h5v5.586l-1.293-1.293zM9 4a1 1 0 012 0v2H9V4z" /></svg>Save Batch</>
                  }
                </button>
              )}
              <button type="button" onClick={handleNewBatch} className="text-xs text-neutral-600 hover:text-neutral-300 transition-colors border border-neutral-800 rounded-lg px-3 py-1.5">
                New Batch
              </button>
            </div>
          </div>

          {/* Post caption preview */}
          {postCaption.trim() && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg border border-neutral-800 bg-neutral-900/40">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-600 shrink-0 mt-0.5 w-20">Post Caption</span>
              <p className="text-[11px] text-neutral-500 leading-relaxed flex-1">{postCaption}</p>
            </div>
          )}

          {/* Save error */}
          {saveError && (
            <div className="rounded-xl border border-red-900 bg-red-950/30 px-4 py-3 flex flex-col gap-1.5">
              <p className="text-xs font-semibold text-red-400">Save failed</p>
              <p className="text-xs text-red-500">{saveError}</p>
              {isSqlMissingError(saveError) && (
                <p className="text-[11px] text-amber-500 border-t border-red-900/50 pt-1.5">
                  <strong>SQL required:</strong> Run the <code className="font-mono">campaign_batches</code> and <code className="font-mono">campaign_items</code> migrations in your Supabase SQL editor.
                </p>
              )}
            </div>
          )}

          {/* Batch action bar */}
          {savedBatchData && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                {isRunningAll && runAllProgress ? (
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full animate-spin" style={{ border: "2px solid transparent", borderTopColor: "#a3e635", borderRightColor: "#22d3ee" }} />
                    <span className="text-xs font-semibold text-amber-400">Generating {runAllProgress.done + 1} of {runAllProgress.total}…</span>
                  </div>
                ) : completeCount > 0 ? (
                  <span className="text-xs font-semibold text-emerald-400">{completeCount} video{completeCount !== 1 ? "s" : ""} complete</span>
                ) : (
                  <span className="text-xs font-semibold text-emerald-400">Batch saved · ready to generate</span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Run All Videos */}
                <button type="button" onClick={handleRunAll}
                  disabled={isRunningAll || isDeletingBatch}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                    isRunningAll || isDeletingBatch
                      ? "border-neutral-800 text-neutral-600 cursor-wait opacity-60"
                      : "border-neutral-600 text-neutral-300 hover:text-white hover:border-neutral-400"
                  }`}
                >
                  {isRunningAll ? (
                    <><span className="w-2.5 h-2.5 rounded-full animate-spin" style={{ border: "2px solid transparent", borderTopColor: "#a3e635", borderRightColor: "#22d3ee" }} />Running…</>
                  ) : (
                    <><svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>Run All Videos</>
                  )}
                </button>

                {/* Go to Library */}
                {anyDone && onSwitchToLibrary && (
                  <button type="button" onClick={onSwitchToLibrary}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-emerald-900 text-xs font-semibold text-emerald-400 hover:text-emerald-300 hover:border-emerald-700 transition-colors">
                    <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" /></svg>
                    Go to Library
                  </button>
                )}

                {/* Delete Batch */}
                <button type="button" onClick={handleDeleteBatch} disabled={isDeletingBatch || isRunningAll}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-neutral-800 text-xs font-semibold text-neutral-500 hover:text-red-400 hover:border-red-900 transition-colors disabled:opacity-50 disabled:cursor-wait">
                  {isDeletingBatch
                    ? <><span className="w-2.5 h-2.5 rounded-full animate-spin" style={{ border: "2px solid transparent", borderTopColor: "#ef4444", borderRightColor: "#ef4444" }} />Deleting…</>
                    : <><svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>Delete Batch</>
                  }
                </button>
              </div>
            </div>
          )}

          {/* Run All completion note */}
          {anyDone && !onSwitchToLibrary && (
            <p className="text-xs text-emerald-500 leading-relaxed">
              Videos saved to Library. Open the <strong>Library</strong> tab to review and post.
            </p>
          )}

          {/* Delete batch error */}
          {deleteBatchError && (
            <div className="rounded-xl border border-red-900 bg-red-950/30 px-4 py-3">
              <p className="text-xs font-semibold text-red-400 mb-0.5">Delete failed</p>
              <p className="text-xs text-red-500">{deleteBatchError}</p>
            </div>
          )}

          {/* Concept cards */}
          {visibleCount > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {batchPlan.items.map((item, i) => {
                const itemId = savedBatchData?.itemIds[i];
                if (itemId && deletedItemIds.includes(itemId)) return null;
                return (
                  <ConceptCard key={i} item={item} index={i}
                    saved={!!savedBatchData} itemId={itemId}
                    genState={itemId ? itemGenStates[itemId] : undefined}
                    includeVoiceover={batchPlan.includeVoiceover}
                    onGenerate={handleGenerateItem}
                    onDelete={handleDeleteItem}
                  />
                );
              })}
            </div>
          ) : savedBatchData ? (
            <div className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/30 px-6 py-10 flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-neutral-600">All concepts deleted.</p>
              <button type="button" onClick={handleNewBatch} className="text-xs text-neutral-500 hover:text-neutral-300 border border-neutral-800 rounded-lg px-3 py-1.5 transition-colors">Start New Batch</button>
            </div>
          ) : null}

          {!savedBatchData && visibleCount > 0 && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 px-5 py-4 flex items-start gap-3">
              <svg className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
              <div><span className="text-xs font-semibold text-neutral-300">Review before saving.</span><p className="text-xs text-neutral-500 mt-0.5">Save the batch to enable per-prompt video generation.</p></div>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {useChatGPT && !batchPlan && !isGenerating && (
        <div className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/30 px-6 py-10 flex flex-col items-center gap-3 text-center">
          <svg className="w-8 h-8 text-neutral-700" viewBox="0 0 20 20" fill="currentColor"><path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" /></svg>
          <p className="text-sm text-neutral-600">8 Seedance prompts will appear here.</p>
          <p className="text-xs text-neutral-700 max-w-xs">Upload images, tag them, write a brief, and click Create 8 Prompts.</p>
        </div>
      )}

      {/* Safety note */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 px-5 py-4 flex items-start gap-3">
        <svg className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
        <div>
          <span className="text-xs font-semibold text-neutral-300">Nothing posts automatically.</span>
          <p className="text-xs text-neutral-500 mt-0.5">Batch videos save to Library for review. Post to any connected platform from there.</p>
        </div>
      </div>

    </div>
  );
}
