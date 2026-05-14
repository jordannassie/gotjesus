"use client";

import { useState, useRef, useCallback } from "react";
import type { ContentSlot } from "@/lib/content-slots";

type SaveStatus = "idle" | "saving" | "saved" | "error";
type GenStatus = "idle" | "submitting" | "generating" | "saving" | "done" | "error";

interface Props {
  slot: ContentSlot;
  onSlotUpdate: (updated: ContentSlot) => void;
}

const POLL_INTERVAL_MS = 6000;
const MAX_POLLS = 120;

const DURATION_OPTIONS = [5, 8, 10, 12, 15];
const RESOLUTION_OPTIONS = ["480p", "720p", "1080p"];

// No client-side aspect ratio validation on reference images.
// The server (generate-video route) silently filters out any image whose pixel
// dimensions fall outside Kie.ai's accepted range [0.4–2.5] before the request
// is sent. This lets users upload brand assets at any size without errors.

export default function ContentSlotCard({ slot, onSlotUpdate }: Props) {
  const [slotName, setSlotName] = useState(slot.slotName);
  const [promptText, setPromptText] = useState(slot.promptText);
  const [enabled, setEnabled] = useState(slot.enabled);
  const [scheduledTime, setScheduledTime] = useState(slot.scheduledPostTime);
  const [duration, setDuration] = useState(slot.durationSeconds);
  const [resolution, setResolution] = useState(slot.resolution);
  const [images, setImages] = useState(slot.referenceImages);

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [removingPath, setRemovingPath] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const [genStatus, setGenStatus] = useState<GenStatus>("idle");
  const [genError, setGenError] = useState("");
  const [testVideoUrl, setTestVideoUrl] = useState<string | null>(null);
  const [showTestVideo, setShowTestVideo] = useState(false);
  const genPollCount = useRef(0);
  const genTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          enabled,
          scheduledPostTime: scheduledTime,
          durationSeconds: duration,
          aspectRatio: "9:16", // locked — output is always 9:16 vertical
          resolution,
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
  }, [slot.id, slotName, promptText, enabled, scheduledTime, duration, resolution, onSlotUpdate]);

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
      setImages(data.referenceImages);
      onSlotUpdate(data);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploadingImage(false);
    }
  }, [slot.id, onSlotUpdate]);

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
      setImages(data.referenceImages);
      onSlotUpdate(data);
    } catch { /* ignore */ } finally {
      setRemovingPath(null);
    }
  }, [slot.id, onSlotUpdate]);

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
    try {
      const res = await fetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptOverride: promptText,
          referenceImageUrls: images.map((img) => img.url),
          slotKey: slot.slotKey,
          resolution,
          duration,
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
  }, [promptText, images, slot.slotKey, slotName, resolution, duration, pollGen, stopGenPoll]);

  const genRunning = ["submitting", "generating", "saving"].includes(genStatus);
  const genLabel =
    genStatus === "submitting" ? "Submitting…" :
    genStatus === "generating" ? "Generating…" :
    genStatus === "saving" ? "Saving…" : "";

  return (
    <div className="w-full border border-neutral-800 rounded-2xl bg-neutral-950 overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-3.5 border-b border-neutral-800 bg-neutral-900/40">
        <input
          type="text"
          value={slotName}
          onChange={(e) => setSlotName(e.target.value)}
          className="flex-1 bg-transparent text-white font-semibold text-sm outline-none border-b border-transparent hover:border-neutral-700 focus:border-neutral-500 transition-colors pb-0.5 min-w-0"
          placeholder="Slot name"
        />
        <div className="flex items-center gap-2.5 shrink-0">
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
            onClick={() => setEnabled((v) => !v)}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 cursor-pointer ${enabled ? "bg-emerald-500" : "bg-neutral-700"}`}
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200 ${enabled ? "translate-x-4" : "translate-x-1"}`} />
          </button>
          <span className={`text-xs font-medium w-14 ${enabled ? "text-emerald-400" : "text-neutral-600"}`}>
            {enabled ? "Enabled" : "Disabled"}
          </span>
        </div>
      </div>

      <div className="px-5 py-4 flex flex-col gap-4">
        {/* Image chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          {images.map((img) => (
            <div key={img.path} className="group relative flex items-center gap-1 bg-neutral-800 border border-neutral-700 rounded-lg overflow-hidden pr-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={img.name} className="w-8 h-8 object-cover flex-shrink-0" />
              <span className="text-[10px] text-neutral-400 max-w-[60px] truncate">{img.name}</span>
              <button
                type="button"
                onClick={() => void handleRemoveImage(img.path)}
                disabled={removingPath === img.path}
                className="ml-0.5 text-neutral-600 hover:text-red-400 transition-colors text-xs leading-none"
              >
                {removingPath === img.path ? "…" : "×"}
              </button>
            </div>
          ))}
          <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleImageFileChange} />
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            disabled={uploadingImage}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-dashed border-neutral-700 text-[11px] text-neutral-500 hover:text-neutral-300 hover:border-neutral-500 transition-colors disabled:opacity-50"
          >
            {uploadingImage ? <span className="w-2.5 h-2.5 border border-neutral-600 border-t-white rounded-full animate-spin inline-block" /> : "+"}
            {uploadingImage ? "Uploading…" : "Add Image"}
          </button>
          {uploadError && <span className="text-[11px] text-red-400">{uploadError}</span>}
        </div>

        {/* Compact prompt textarea */}
        <textarea
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          placeholder="Describe your scene in detail. Use @ to reference attached images."
          className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-sm text-neutral-200 placeholder-neutral-600 resize-none outline-none focus:border-neutral-600 focus:ring-1 focus:ring-neutral-700 transition-colors leading-relaxed overflow-y-auto"
          style={{ height: "130px" }}
        />

        {/* Editable settings row */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Model — read-only */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-neutral-800 bg-neutral-900">
            <span className="text-[10px] text-neutral-600 uppercase tracking-widest">Model</span>
            <span className="text-xs text-neutral-400 font-medium">Seedance 2.0</span>
          </div>

          {/* Duration — editable */}
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

          {/* Aspect ratio — locked to 9:16 */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-neutral-800 bg-neutral-900" title="Output is locked to 9:16 vertical">
            <span className="text-[10px] text-neutral-600 uppercase tracking-widest">Aspect</span>
            <span className="text-xs text-neutral-500 font-medium">9:16 ⚙</span>
          </div>

          {/* Resolution — editable */}
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

        {/* Action row */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button
            type="button"
            onClick={handleGenerateTest}
            disabled={genRunning}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-neutral-700 bg-neutral-900 text-xs text-neutral-300 hover:bg-neutral-800 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {genRunning ? (
              <><span className="w-3 h-3 border border-neutral-600 border-t-white rounded-full animate-spin inline-block" />{genLabel || "In progress…"}</>
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
              <span className="text-xs font-medium text-emerald-400">Test generated ✓</span>
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
