"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { ContentSlot, SlotImage, SlotMusic } from "@/lib/content-slots";

type SaveStatus = "idle" | "saving" | "saved" | "error";
type GenStatus = "idle" | "submitting" | "generating" | "saving" | "done" | "error";

interface Props {
  slot: ContentSlot;
  onSlotUpdate: (updated: ContentSlot) => void;
  onDelete: (id: string) => void;
  onDuplicate: (slot: ContentSlot) => void;
  isLastSlot?: boolean;
}

const POLL_INTERVAL_MS = 6000;
const MAX_POLLS = 120;

const DURATION_OPTIONS = [5, 8, 10, 12, 15];
const RESOLUTION_OPTIONS = ["480p", "720p", "1080p"];

const TAG_SUGGESTIONS = [
  "@product1", "@product2", "@product3",
  "@model1", "@model2", "@model3",
  "@logo", "@brandcard",
];

// Auto-fill a default tag based on position when none is stored
function defaultTagForIndex(idx: number): string {
  return `@product${idx + 1}`;
}

// Normalise tag input: ensure it starts with @
function normaliseTag(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

// Merge DB images with local state, preserving local tag/info edits for unchanged paths
function mergeImages(dbImages: SlotImage[], local: SlotImage[]): SlotImage[] {
  const localMap = new Map(local.map((img) => [img.path, img]));
  return dbImages.map((img, i) => {
    const existing = localMap.get(img.path);
    if (existing) return existing;
    return { ...img, tag: img.tag ?? defaultTagForIndex(i), info: img.info ?? "" };
  });
}

/**
 * Build an enhanced Seedance prompt that prepends a reference image guide,
 * and an audio guide when @music1 is present.
 * The user's prompt textarea is not changed — this is built internally on Generate Test.
 */
function buildEnhancedPrompt(
  promptText: string,
  images: SlotImage[],
  music?: SlotMusic | null
): string {
  const tagged = images.filter(
    (img) => img.tag?.startsWith("@") && (img.info?.trim() || img.name)
  );
  const hasImages = tagged.length > 0;
  const hasMusic = Boolean(music?.url);

  if (!hasImages && !hasMusic) return promptText;

  const parts: string[] = [];

  if (hasImages) {
    const guide = tagged.map((img) => `${img.tag} = ${img.info?.trim() || img.name}`).join("\n");
    parts.push("Reference images:", guide, "");
  }

  if (hasMusic) {
    const musicLabel = music!.info?.trim() || music!.name;
    parts.push(
      "Reference music:",
      `${music!.tag ?? "@music1"} = ${musicLabel}`,
      ""
    );
  }

  parts.push("User prompt:", promptText, "", "Rules:");
  parts.push(
    "- Preserve product/reference images exactly.",
    "- Do not invent logos, text, captions, or extra graphics.",
    "- No captions, no subtitles, no text overlays, no extra words on screen.",
    "- Do not alter product design."
  );

  if (hasMusic) {
    parts.push(
      `- Use ${music!.tag ?? "@music1"} as the exact soundtrack.`,
      "- Do not generate voiceover, talking, narration, captions, or subtitles.",
      "- Do not create extra AI music.",
      "- Final video audio must be the uploaded @music1 song only."
    );
  }

  return parts.join("\n");
}

// No client-side aspect ratio validation on reference images.
// The server (generate-video route) silently filters out any image whose pixel
// dimensions fall outside Kie.ai's accepted range [0.4–2.5] before the request
// is sent. This lets users upload brand assets at any size without errors.

export default function ContentSlotCard({
  slot,
  onSlotUpdate,
  onDelete,
  onDuplicate,
  isLastSlot = false,
}: Props) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [slotName, setSlotName] = useState(slot.slotName);
  const [promptText, setPromptText] = useState(slot.promptText);
  const [postCaption, setPostCaption] = useState(slot.postCaption ?? "");
  const [enabled, setEnabled] = useState(slot.enabled);
  const [scheduledTime, setScheduledTime] = useState(slot.scheduledPostTime);
  const [duration, setDuration] = useState(slot.durationSeconds);
  const [resolution, setResolution] = useState(slot.resolution);

  // Images with tag/info: init from DB, auto-fill tag if missing
  const [images, setImages] = useState<SlotImage[]>(() =>
    slot.referenceImages.map((img, i) => ({
      ...img,
      tag: img.tag ?? defaultTagForIndex(i),
      info: img.info ?? "",
    }))
  );

  // Music: init from DB
  const [music, setMusic] = useState<SlotMusic | null>(slot.referenceMusic ?? null);
  const [musicTag, setMusicTag] = useState<string>(slot.referenceMusic?.tag ?? "@music1");
  const [musicInfo, setMusicInfo] = useState<string>(slot.referenceMusic?.info ?? "Got Jesus song");
  const [uploadingMusic, setUploadingMusic] = useState(false);
  const [musicUploadError, setMusicUploadError] = useState("");
  const [removingMusic, setRemovingMusic] = useState(false);
  const musicInputRef = useRef<HTMLInputElement>(null);

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [promptCopied, setPromptCopied] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [removingPath, setRemovingPath] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const [genStatus, setGenStatus] = useState<GenStatus>("idle");
  const [genError, setGenError] = useState("");
  const [testVideoUrl, setTestVideoUrl] = useState<string | null>(null);
  const [showTestVideo, setShowTestVideo] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const genPollCount = useRef(0);
  const genTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressStart = useRef(0);

  // Animate the progress bar while generation is running.
  useEffect(() => {
    const running = ["submitting", "generating", "saving"].includes(genStatus);

    if (running) {
      if (!progressTimer.current) {
        progressStart.current = Date.now();
        setGenProgress(0);
        progressTimer.current = setInterval(() => {
          const elapsed = (Date.now() - progressStart.current) / 1000;
          const pct = 90 * (1 - Math.exp(-elapsed / 80));
          setGenProgress(Math.min(pct, 89));
        }, 400);
      }
    } else {
      if (progressTimer.current) {
        clearInterval(progressTimer.current);
        progressTimer.current = null;
      }
      if (genStatus === "done") {
        setGenProgress(100);
        setTimeout(() => setGenProgress(0), 2000);
      } else if (genStatus === "error") {
        setGenProgress(0);
      }
    }

    return () => {
      if (progressTimer.current) {
        clearInterval(progressTimer.current);
        progressTimer.current = null;
      }
    };
  }, [genStatus]);

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setSaveStatus("saving");
    setSaveError("");
    try {
      const res = await fetch("/api/content-slots", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: slot.id,
          slotName,
          promptText,
          postCaption,
          enabled,
          scheduledPostTime: scheduledTime,
          durationSeconds: duration,
          aspectRatio: "9:16",
          resolution,
          referenceImages: images, // persist tag/info edits
          referenceMusic: music ? { ...music, tag: musicTag, info: musicInfo } : null,
        }),
      });
      const data = (await res.json()) as ContentSlot & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onSlotUpdate(data);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
      setSaveStatus("error");
    }
  }, [slot.id, slotName, promptText, postCaption, enabled, scheduledTime, duration, resolution, images, music, musicTag, musicInfo, onSlotUpdate]);

  // Toggle enabled and immediately persist
  const handleToggleEnabled = useCallback(async () => {
    const next = !enabled;
    setEnabled(next);
    try {
      const res = await fetch("/api/content-slots", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: slot.id, enabled: next }),
      });
      const data = (await res.json()) as ContentSlot & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onSlotUpdate(data);
    } catch {
      setEnabled(!next);
    }
  }, [enabled, slot.id, onSlotUpdate]);

  // ── Image tag/info editing ─────────────────────────────────────────────────

  const handleUpdateImageMeta = useCallback((path: string, updates: { tag?: string; info?: string }) => {
    setImages((prev) =>
      prev.map((img) =>
        img.path === path
          ? {
              ...img,
              ...(updates.tag !== undefined ? { tag: normaliseTag(updates.tag) } : {}),
              ...(updates.info !== undefined ? { info: updates.info } : {}),
            }
          : img
      )
    );
  }, []);

  // ── Image upload ──────────────────────────────────────────────────────────

  const handleImageFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploadingImage(true);
    setUploadError("");
    try {
      const form = new FormData();
      form.append("slotId", slot.id);
      form.append("file", file);
      const res = await fetch("/api/content-slots/upload", { method: "POST", body: form });
      const data = (await res.json()) as ContentSlot & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      // Merge DB images with local state to preserve tag/info edits
      const merged = mergeImages(data.referenceImages, images);
      setImages(merged);
      onSlotUpdate({ ...data, referenceImages: merged });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploadingImage(false);
    }
  }, [slot.id, images, onSlotUpdate]);

  const handleRemoveImage = useCallback(async (path: string) => {
    setRemovingPath(path);
    try {
      const res = await fetch("/api/content-slots/image", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId: slot.id, path }),
      });
      const data = (await res.json()) as ContentSlot & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const merged = mergeImages(data.referenceImages, images);
      setImages(merged);
      onSlotUpdate({ ...data, referenceImages: merged });
    } catch { /* ignore */ } finally {
      setRemovingPath(null);
    }
  }, [slot.id, images, onSlotUpdate]);

  // ── Music upload ──────────────────────────────────────────────────────────

  const handleMusicFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploadingMusic(true);
    setMusicUploadError("");
    try {
      const form = new FormData();
      form.append("slotId", slot.id);
      form.append("file", file);
      const res = await fetch("/api/content-slots/music", { method: "POST", body: form });
      const data = (await res.json()) as ContentSlot & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const newMusic = data.referenceMusic ?? null;
      setMusic(newMusic);
      setMusicTag(newMusic?.tag ?? "@music1");
      setMusicInfo(newMusic?.info ?? "Got Jesus song");
      onSlotUpdate(data);
    } catch (err) {
      setMusicUploadError(err instanceof Error ? err.message : "Music upload failed.");
    } finally {
      setUploadingMusic(false);
    }
  }, [slot.id, onSlotUpdate]);

  const handleRemoveMusic = useCallback(async () => {
    if (!music) return;
    setRemovingMusic(true);
    try {
      const res = await fetch("/api/content-slots/music", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId: slot.id, path: music.path }),
      });
      const data = (await res.json()) as ContentSlot & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setMusic(null);
      setMusicTag("@music1");
      setMusicInfo("Got Jesus song");
      onSlotUpdate(data);
    } catch { /* ignore */ } finally {
      setRemovingMusic(false);
    }
  }, [slot.id, music, onSlotUpdate]);

  // ── Generate test ─────────────────────────────────────────────────────────

  const stopGenPoll = useCallback(() => {
    if (genTimer.current) { clearTimeout(genTimer.current); genTimer.current = null; }
  }, []);

  const pollGen = useCallback(async (taskId: string, onSuccess: (url: string) => void) => {
    if (genPollCount.current >= MAX_POLLS) {
      stopGenPoll(); setGenStatus("error"); setGenError("Generation timed out."); return;
    }
    genPollCount.current += 1;
    try {
      const res = await fetch(`/api/generate-video?taskId=${taskId}`);
      const data = (await res.json()) as { state?: string; videoUrl?: string | null; failMsg?: string | null; error?: string };
      if (!res.ok || data.error) { stopGenPoll(); setGenStatus("error"); setGenError(data.error ?? "Poll error."); return; }
      const raw = data.state ?? "waiting";
      if (raw === "success" && data.videoUrl) { stopGenPoll(); onSuccess(data.videoUrl); return; }
      if (raw === "fail") { stopGenPoll(); setGenStatus("error"); setGenError(data.failMsg ?? "Kie generation failed."); return; }
      setGenStatus("generating");
      genTimer.current = setTimeout(() => void pollGen(taskId, onSuccess), POLL_INTERVAL_MS);
    } catch (err) {
      stopGenPoll(); setGenStatus("error"); setGenError(err instanceof Error ? err.message : "Poll error.");
    }
  }, [stopGenPoll]);

  const handleGenerateTest = useCallback(async () => {
    stopGenPoll();
    setGenStatus("submitting"); setGenError(""); setTestVideoUrl(null); setShowTestVideo(false);
    genPollCount.current = 0;

    // Build enhanced prompt with reference image and music guides (user textarea not changed)
    const currentMusic = music ? { ...music, tag: musicTag, info: musicInfo } : null;
    const enhancedPrompt = buildEnhancedPrompt(promptText, images, currentMusic);

    try {
      const res = await fetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptOverride: enhancedPrompt,
          referenceImageUrls: images.map((img) => img.url),
          slotKey: slot.slotKey,
          resolution,
          duration,
          ...(currentMusic?.url ? { musicUrl: currentMusic.url } : {}),
          // aspectRatio omitted — locked to "9:16" server-side
        }),
      });
      const data = (await res.json()) as { taskId?: string; error?: string };
      if (!res.ok || data.error) { setGenStatus("error"); setGenError(data.error ?? "Failed to submit."); return; }
      genTimer.current = setTimeout(
        () => void pollGen(data.taskId!, async (kieVideoUrl) => {
          setGenStatus("saving");
          try {
            await fetch("/api/save-reel", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                kieVideoUrl,
                kieTaskId: data.taskId,
                autoPost: false,
                platforms: [],
                contentSlotKey: slot.slotKey,
                contentSlotName: slotName,
                postCaption: postCaption || undefined,
                workspaceKey: slot.workspaceKey,
                ...(currentMusic?.url ? { musicUrl: currentMusic.url } : {}),
              }),
            });
          } catch { /* non-fatal */ }
          setTestVideoUrl(kieVideoUrl);
          setShowTestVideo(true);
          setGenStatus("done");
        }),
        POLL_INTERVAL_MS
      );
    } catch (err) {
      setGenStatus("error"); setGenError(err instanceof Error ? err.message : "Submit error.");
    }
  }, [promptText, postCaption, images, music, musicTag, musicInfo, slot.slotKey, slotName, resolution, duration, pollGen, stopGenPoll]);

  const genRunning = ["submitting", "generating", "saving"].includes(genStatus);
  const genLabel =
    genStatus === "submitting" ? "Submitting…" :
    genStatus === "generating" ? "Generating…" :
    genStatus === "saving" ? "Saving…" : "";

  return (
    <div
      className="w-full rounded-2xl bg-neutral-950 overflow-hidden transition-all duration-500 relative"
      style={{
        border: genRunning
          ? "1px solid transparent"
          : "1px solid rgb(38 38 38)",
        backgroundImage: genRunning
          ? "linear-gradient(#050505, #050505), linear-gradient(135deg, #a3e635, #22d3ee, #a855f7, #a3e635)"
          : undefined,
        backgroundOrigin: genRunning ? "border-box" : undefined,
        backgroundClip: genRunning ? "padding-box, border-box" : undefined,
        boxShadow: genRunning
          ? "0 0 40px #22d3ee44, 0 0 80px #a3e63530, 0 0 12px #a855f730"
          : undefined,
      }}
    >
      {/* Large neon percent overlay — top-right corner during generation */}
      {genRunning && genProgress > 0 && (
        <div
          className="absolute top-3 right-4 z-10 tabular-nums font-black leading-none pointer-events-none select-none"
          style={{
            fontSize: "clamp(2.5rem, 6vw, 4rem)",
            background: genStatus === "done"
              ? "linear-gradient(135deg, #4ade80, #22d3ee)"
              : "linear-gradient(135deg, #a3e635, #22d3ee, #a855f7)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            filter: "drop-shadow(0 0 12px #22d3ee99)",
            letterSpacing: "-0.04em",
          }}
        >
          {Math.round(genProgress)}%
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-2 px-5 py-3.5 border-b border-neutral-800 bg-neutral-900/40 relative">
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={slotName}
            onChange={(e) => setSlotName(e.target.value)}
            className="flex-1 bg-transparent text-white font-semibold text-sm outline-none border-b border-transparent hover:border-neutral-700 focus:border-neutral-500 transition-colors pb-0.5 min-w-0"
            placeholder="Section name"
          />
          <div className="flex items-center gap-2 shrink-0">
            <input
              type="time"
              value={scheduledTime}
              onChange={(e) => setScheduledTime(e.target.value)}
              className="text-xs text-white bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1 outline-none [color-scheme:dark] cursor-pointer"
            />
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={handleToggleEnabled}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 cursor-pointer ${enabled ? "bg-emerald-500" : "bg-neutral-700"}`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200 ${enabled ? "translate-x-4" : "translate-x-1"}`} />
            </button>
            <span className={`text-xs font-medium w-14 ${enabled ? "text-emerald-400" : "text-neutral-600"}`}>
              {enabled ? "Enabled" : "Disabled"}
            </span>

            {/* Duplicate */}
            <button
              type="button"
              onClick={() => onDuplicate(slot)}
              title="Duplicate section"
              className="w-7 h-7 flex items-center justify-center rounded-lg border border-neutral-800 text-neutral-600 hover:text-neutral-300 hover:border-neutral-700 transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M7 9a2 2 0 012-2h6a2 2 0 012 2v6a2 2 0 01-2 2H9a2 2 0 01-2-2V9z" />
                <path d="M5 3a2 2 0 00-2 2v6a2 2 0 002 2V5h8a2 2 0 00-2-2H5z" />
              </svg>
            </button>

            {/* Delete */}
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              title="Delete section"
              className="w-7 h-7 flex items-center justify-center rounded-lg border border-neutral-800 text-neutral-600 hover:text-red-400 hover:border-red-900 transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>

        {/* Delete confirmation inline */}
        {showDeleteConfirm && (
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-red-900 bg-red-950/30">
            <p className="text-xs text-red-300 flex-1 leading-relaxed">
              {isLastSlot
                ? "This is the last content section. Deleting it means scheduled automation will have no slots to run."
                : "Delete this content section? The prompt and settings will be removed. Previously generated videos are not affected."}
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => { onDelete(slot.id); setShowDeleteConfirm(false); }}
                className="text-[11px] px-3 py-1.5 rounded-lg bg-red-900 text-red-200 hover:bg-red-800 transition-colors font-medium"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="text-[11px] px-3 py-1.5 rounded-lg border border-neutral-800 text-neutral-400 hover:text-neutral-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="px-5 py-4 flex flex-col gap-4">

        {/* ── Reference Images with Tag + Info ─────────────────────────────── */}
        <div className="flex flex-col gap-2">
          {images.length > 0 && (
            <div className="flex flex-col gap-2">
              {images.map((img) => (
                <div key={img.path} className="flex items-start gap-2.5 bg-neutral-900 border border-neutral-800 rounded-xl p-2.5">
                  {/* Thumbnail */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt={img.name} className="w-14 h-14 object-cover rounded-lg flex-shrink-0 bg-neutral-800" />

                  {/* Tag + Info inputs */}
                  <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                    {/* Tag input with suggestion pills */}
                    <div className="flex flex-col gap-1">
                      <input
                        type="text"
                        value={img.tag ?? ""}
                        onChange={(e) => handleUpdateImageMeta(img.path, { tag: e.target.value })}
                        onBlur={(e) => handleUpdateImageMeta(img.path, { tag: normaliseTag(e.target.value) })}
                        placeholder="@product1"
                        className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1 text-[11px] text-neutral-300 placeholder-neutral-600 outline-none focus:border-neutral-500 font-mono"
                      />
                      <div className="flex flex-wrap gap-1">
                        {TAG_SUGGESTIONS.map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => handleUpdateImageMeta(img.path, { tag: t })}
                            className={`text-[9px] px-1.5 py-0.5 rounded font-mono transition-colors ${img.tag === t ? "bg-sky-900/60 text-sky-400 border border-sky-800" : "text-neutral-600 hover:text-neutral-400 border border-neutral-800"}`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Info input */}
                    <input
                      type="text"
                      value={img.info ?? ""}
                      onChange={(e) => handleUpdateImageMeta(img.path, { info: e.target.value })}
                      placeholder="Describe this image… e.g. Back of black T-shirt"
                      className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1 text-[11px] text-neutral-400 placeholder-neutral-700 outline-none focus:border-neutral-500"
                    />
                    <span className="text-[9px] text-neutral-700 truncate">{img.name}</span>
                  </div>

                  {/* Remove */}
                  <button
                    type="button"
                    onClick={() => void handleRemoveImage(img.path)}
                    disabled={removingPath === img.path}
                    className="text-neutral-700 hover:text-red-400 transition-colors text-sm leading-none flex-shrink-0 mt-1"
                    title="Remove image"
                  >
                    {removingPath === img.path ? "…" : "×"}
                  </button>
                </div>
              ))}

              {/* Tag usage helper */}
              <p className="text-[10px] text-neutral-700 leading-relaxed">
                Use the <span className="text-neutral-500">Tag</span> in your prompt (e.g.{" "}
                <span className="font-mono text-neutral-500">@product1</span>) so Seedance knows which image to use.
                Use <span className="text-neutral-500">Info</span> to describe what each image is.
                Tag edits save when you click <strong className="text-neutral-600">Save Slot</strong>.
              </p>
            </div>
          )}

          {/* Upload button */}
          <div className="flex items-center gap-2">
            <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleImageFileChange} />
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={uploadingImage}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-dashed border-neutral-700 text-[11px] text-neutral-500 hover:text-neutral-300 hover:border-neutral-500 transition-colors disabled:opacity-50"
            >
              {uploadingImage
                ? <><span className="w-2.5 h-2.5 rounded-full animate-spin inline-block" style={{ border: "2px solid #22d3ee22", borderTopColor: "#a3e635" }} /> Uploading…</>
                : <><span className="text-base leading-none">+</span> {images.length > 0 ? "Add Image" : "Add Reference Image"}</>
              }
            </button>
          </div>
          {uploadError && <span className="text-[11px] text-red-400">{uploadError}</span>}
          <p className="text-[10px] text-neutral-700 leading-relaxed">
            Upload images as{" "}
            <span className="font-mono text-neutral-600">@product1</span>,{" "}
            <span className="font-mono text-neutral-600">@model1</span>, or{" "}
            <span className="font-mono text-neutral-600">@brandcard</span>.{" "}
            Upload one song as{" "}
            <span className="font-mono text-neutral-600">@music1</span>.{" "}
            When <span className="font-mono text-neutral-600">@music1</span> is uploaded, the app replaces all generated audio with that song.
          </p>
        </div>

        {/* ── Music upload (@music1) ────────────────────────────────────────── */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-600">Music</span>
            {music && (
              <span className="text-[9px] px-1.5 py-0.5 rounded font-mono bg-purple-900/40 text-purple-400 border border-purple-800">@music1</span>
            )}
          </div>

          {music && (
            <div className="flex items-start gap-2.5 bg-neutral-900 border border-purple-900/40 rounded-xl p-2.5">
              {/* Music icon */}
              <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-purple-900/30 border border-purple-800/40 flex-shrink-0">
                <svg className="w-5 h-5 text-purple-400" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
                </svg>
              </div>

              {/* Tag + Info inputs */}
              <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                <input
                  type="text"
                  value={musicTag}
                  onChange={(e) => setMusicTag(e.target.value.trim().startsWith("@") ? e.target.value.trim() : `@${e.target.value.trim()}`)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1 text-[11px] text-purple-300 placeholder-neutral-600 outline-none focus:border-purple-700 font-mono"
                  placeholder="@music1"
                />
                <input
                  type="text"
                  value={musicInfo}
                  onChange={(e) => setMusicInfo(e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1 text-[11px] text-neutral-400 placeholder-neutral-700 outline-none focus:border-neutral-500"
                  placeholder="Describe this song… e.g. Got Jesus song"
                />
                <span className="text-[9px] text-neutral-700 truncate">{music.name}</span>
              </div>

              {/* Remove */}
              <button
                type="button"
                onClick={() => void handleRemoveMusic()}
                disabled={removingMusic}
                className="text-neutral-700 hover:text-red-400 transition-colors text-sm leading-none flex-shrink-0 mt-1"
                title="Remove music"
              >
                {removingMusic ? "…" : "×"}
              </button>
            </div>
          )}

          {/* Upload / Replace button */}
          <div className="flex items-center gap-2">
            <input
              ref={musicInputRef}
              type="file"
              accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/ogg"
              className="hidden"
              onChange={handleMusicFileChange}
            />
            <button
              type="button"
              onClick={() => musicInputRef.current?.click()}
              disabled={uploadingMusic}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-dashed border-purple-900 text-[11px] text-purple-600 hover:text-purple-400 hover:border-purple-700 transition-colors disabled:opacity-50"
            >
              {uploadingMusic
                ? <><span className="w-2.5 h-2.5 rounded-full animate-spin inline-block" style={{ border: "2px solid #a855f722", borderTopColor: "#a855f7" }} /> Uploading…</>
                : <>
                    <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
                    </svg>
                    {music ? "Replace Music" : "Add Music"}
                  </>
              }
            </button>
          </div>
          {musicUploadError && <span className="text-[11px] text-red-400">{musicUploadError}</span>}
        </div>

        {/* ── Prompt textarea ───────────────────────────────────────────────── */}
        <div className="flex flex-col gap-1.5">
          <div className="relative">
            <textarea
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              placeholder="Describe your scene in detail. Use @product1, @model1, etc. to reference attached images."
              className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-2.5 pr-9 text-sm text-neutral-200 placeholder-neutral-600 resize-none outline-none focus:border-neutral-600 focus:ring-1 focus:ring-neutral-700 transition-colors leading-relaxed overflow-y-auto"
              style={{ height: "130px" }}
            />
            <button
              type="button"
              title="Copy prompt text"
              onClick={() => {
                void navigator.clipboard.writeText(promptText).then(() => {
                  setPromptCopied(true);
                  setTimeout(() => setPromptCopied(false), 2000);
                });
              }}
              className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-md border border-neutral-700 text-neutral-600 hover:text-neutral-300 hover:border-neutral-500 bg-neutral-900 transition-colors"
            >
              {promptCopied ? (
                <svg className="w-3 h-3 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                  <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                </svg>
              )}
            </button>
          </div>
          {/* Tip: tag usage */}
          <p className="text-[10px] text-neutral-700 leading-relaxed">
            Tip: Use image tags like{" "}
            <span className="font-mono text-neutral-600">@product1</span>,{" "}
            <span className="font-mono text-neutral-600">@model1</span>, or{" "}
            <span className="font-mono text-neutral-600">@logo</span>{" "}
            in your prompt so Seedance knows which reference image to use.
            {music && (
              <> Use{" "}
                <span className="font-mono text-purple-700">@music1</span>{" "}
                to reference the uploaded song — it will replace all generated audio in the final video.
              </>
            )}
          </p>
        </div>

        {/* ── Post Caption ──────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-widest text-neutral-600">
            Post Caption
          </label>
          <textarea
            value={postCaption}
            onChange={(e) => setPostCaption(e.target.value)}
            placeholder="Jesus Loves You! #jesus #gotjesus gotjesus.co"
            rows={2}
            className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-2 text-xs text-neutral-300 placeholder-neutral-700 resize-none outline-none focus:border-neutral-600 focus:ring-1 focus:ring-neutral-700 transition-colors leading-relaxed"
          />
        </div>

        {/* ── Settings row ──────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-neutral-800 bg-neutral-900">
            <span className="text-[10px] text-neutral-600 uppercase tracking-widest">Model</span>
            <span className="text-xs text-neutral-400 font-medium">Seedance 2.0</span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-neutral-800 bg-neutral-900">
            <span className="text-[10px] text-neutral-600 uppercase tracking-widest">Duration</span>
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="text-xs text-neutral-300 bg-transparent outline-none cursor-pointer"
            >
              {DURATION_OPTIONS.map((d) => (
                <option key={d} value={d} className="bg-neutral-900">{d}s</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-neutral-800 bg-neutral-900" title="Output is locked to 9:16 vertical">
            <span className="text-[10px] text-neutral-600 uppercase tracking-widest">Aspect</span>
            <span className="text-xs text-neutral-500 font-medium">9:16 ⚙</span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-neutral-800 bg-neutral-900">
            <span className="text-[10px] text-neutral-600 uppercase tracking-widest">Res</span>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              className="text-xs text-neutral-300 bg-transparent outline-none cursor-pointer"
            >
              {RESOLUTION_OPTIONS.map((r) => (
                <option key={r} value={r} className="bg-neutral-900">{r}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Generation progress bar ───────────────────────────────────────── */}
        {(genRunning || genStatus === "done") && genProgress > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="w-full h-1.5 rounded-full bg-neutral-800 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${genProgress}%`,
                  background: genStatus === "done"
                    ? "linear-gradient(90deg, #4ade80, #22d3ee)"
                    : "linear-gradient(90deg, #a3e635, #22d3ee, #a855f7)",
                  boxShadow: genStatus === "done"
                    ? "0 0 8px #4ade8088"
                    : "0 0 10px #22d3ee66, 0 0 4px #a3e63566",
                }}
              />
            </div>
            <div className="flex items-center">
              <span className="text-[10px] font-medium tracking-wide uppercase"
                style={{ color: genStatus === "done" ? "#4ade80" : "#22d3ee" }}>
                {genStatus === "submitting" && (genProgress < 5 ? "Starting generation…" : "Sending prompt and images…")}
                {genStatus === "generating" && (genProgress < 80 ? "Generating video…" : "Finalizing end card…")}
                {genStatus === "saving" && "Saving to Library…"}
                {genStatus === "done" && "Complete ✓"}
              </span>
            </div>
          </div>
        )}

        {/* ── Action row ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button
            type="button"
            onClick={handleGenerateTest}
            disabled={genRunning}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-neutral-700 bg-neutral-900 text-xs text-neutral-300 hover:bg-neutral-800 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {genRunning ? (
              <><span className="w-3 h-3 rounded-full animate-spin inline-block" style={{ border: "2px solid #22d3ee44", borderTopColor: "#a3e635", borderRightColor: "#22d3ee" }} />{genLabel || "In progress…"}</>
            ) : (
              <><svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>Generate Test</>
            )}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saveStatus === "saving"}
            className="px-4 py-2 rounded-lg bg-white text-black text-xs font-semibold hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved ✓" : "Save Slot"}
          </button>
        </div>

        {/* Errors */}
        {saveStatus === "error" && saveError && <p className="text-xs text-red-400">{saveError}</p>}
        {genStatus === "error" && genError && (
          <div className="rounded-lg border border-red-900 bg-red-950/30 px-3 py-2">
            <p className="text-xs text-red-400">{genError}</p>
          </div>
        )}

        {/* Test video */}
        {genStatus === "done" && testVideoUrl && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-emerald-400">Generation complete — saved to Library ✓</span>
              <button type="button" onClick={() => setShowTestVideo((v) => !v)} className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors">
                {showTestVideo ? "Hide ↑" : "Show ↓"}
              </button>
            </div>
            {showTestVideo && (
              <div className="w-full max-w-[140px] mx-auto rounded-xl overflow-hidden border border-neutral-700">
                <div className="relative w-full" style={{ aspectRatio: "9 / 16" }}>
                  <video src={testVideoUrl} controls playsInline autoPlay className="absolute inset-0 w-full h-full object-contain bg-black" />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
