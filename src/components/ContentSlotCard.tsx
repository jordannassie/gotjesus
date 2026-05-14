"use client";

import { useState, useRef, useCallback } from "react";
import type { ContentSlot } from "@/lib/content-slots";

// ─── Types ────────────────────────────────────────────────────────────────────

type SaveStatus = "idle" | "saving" | "saved" | "error";
type GenStatus = "idle" | "submitting" | "generating" | "saving" | "done" | "error";

interface Props {
  slot: ContentSlot;
  onSlotUpdate: (updated: ContentSlot) => void;
}

const POLL_INTERVAL_MS = 6000;
const MAX_POLLS = 120;

// ─── Component ────────────────────────────────────────────────────────────────

export default function ContentSlotCard({ slot, onSlotUpdate }: Props) {
  // ── Local edit state (mirrors slot, editable) ─────────────────────────────
  const [slotName, setSlotName] = useState(slot.slotName);
  const [promptText, setPromptText] = useState(slot.promptText);
  const [enabled, setEnabled] = useState(slot.enabled);
  const [scheduledTime, setScheduledTime] = useState(slot.scheduledPostTime);
  const [images, setImages] = useState(slot.referenceImages);

  // ── Save state ────────────────────────────────────────────────────────────
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string>("");

  // ── Image upload state ────────────────────────────────────────────────────
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState<string>("");
  const [removingPath, setRemovingPath] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // ── Generation test state ─────────────────────────────────────────────────
  const [genStatus, setGenStatus] = useState<GenStatus>("idle");
  const [genError, setGenError] = useState<string>("");
  const [testVideoUrl, setTestVideoUrl] = useState<string | null>(null);
  const [showTestVideo, setShowTestVideo] = useState(false);
  const genPollCount = useRef(0);
  const genTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Save slot ─────────────────────────────────────────────────────────────

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
  }, [slot.id, slotName, promptText, enabled, scheduledTime, onSlotUpdate]);

  // ── Image upload ──────────────────────────────────────────────────────────

  const handleImageFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";
      setUploadingImage(true);
      setUploadError("");
      try {
        const form = new FormData();
        form.append("slotId", slot.id);
        form.append("file", file);
        const res = await fetch("/api/content-slots/upload", {
          method: "POST",
          body: form,
        });
        const data = (await res.json()) as ContentSlot & { error?: string };
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setImages(data.referenceImages);
        onSlotUpdate(data);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setUploadingImage(false);
      }
    },
    [slot.id, onSlotUpdate]
  );

  const handleRemoveImage = useCallback(
    async (path: string) => {
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
      } catch {
        // ignore — image stays in UI
      } finally {
        setRemovingPath(null);
      }
    },
    [slot.id, onSlotUpdate]
  );

  // ── Generate test ─────────────────────────────────────────────────────────

  const stopGenPoll = useCallback(() => {
    if (genTimer.current) {
      clearTimeout(genTimer.current);
      genTimer.current = null;
    }
  }, []);

  const pollGen = useCallback(
    async (taskId: string, onSuccess: (url: string) => void) => {
      if (genPollCount.current >= MAX_POLLS) {
        stopGenPoll();
        setGenStatus("error");
        setGenError("Generation timed out.");
        return;
      }
      genPollCount.current += 1;

      try {
        const res = await fetch(`/api/generate-video?taskId=${taskId}`);
        const data = (await res.json()) as {
          state?: string;
          videoUrl?: string | null;
          failMsg?: string | null;
          error?: string;
        };

        if (!res.ok || data.error) {
          stopGenPoll();
          setGenStatus("error");
          setGenError(data.error ?? "Poll error.");
          return;
        }

        const raw = data.state ?? "waiting";

        if (raw === "success" && data.videoUrl) {
          stopGenPoll();
          onSuccess(data.videoUrl);
          return;
        }
        if (raw === "fail") {
          stopGenPoll();
          setGenStatus("error");
          setGenError(data.failMsg ?? "Kie generation failed.");
          return;
        }

        setGenStatus("generating");
        genTimer.current = setTimeout(() => void pollGen(taskId, onSuccess), POLL_INTERVAL_MS);
      } catch (err) {
        stopGenPoll();
        setGenStatus("error");
        setGenError(err instanceof Error ? err.message : "Poll error.");
      }
    },
    [stopGenPoll]
  );

  const handleGenerateTest = useCallback(async () => {
    stopGenPoll();
    setGenStatus("submitting");
    setGenError("");
    setTestVideoUrl(null);
    setShowTestVideo(false);
    genPollCount.current = 0;

    try {
      const res = await fetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptOverride: promptText,
          referenceImageUrls: images.map((img) => img.url),
          slotKey: slot.slotKey,
          resolution: slot.resolution,
          duration: slot.durationSeconds,
        }),
      });
      const data = (await res.json()) as { taskId?: string; error?: string };
      if (!res.ok || data.error) {
        setGenStatus("error");
        setGenError(data.error ?? "Failed to submit.");
        return;
      }

      const taskId = data.taskId!;
      genTimer.current = setTimeout(
        () =>
          void pollGen(taskId, async (kieVideoUrl) => {
            // Auto-save to library (no social posting)
            setGenStatus("saving");
            try {
              const saveRes = await fetch("/api/save-reel", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  kieVideoUrl,
                  kieTaskId: taskId,
                  autoPost: false,
                  platforms: [],
                }),
              });
              const saveData = (await saveRes.json()) as { error?: string };
              if (!saveRes.ok)
                console.warn("[content-slot] save-reel warning:", saveData.error);
            } catch {
              // non-fatal — video still shows
            }
            setTestVideoUrl(kieVideoUrl);
            setShowTestVideo(true);
            setGenStatus("done");
          }),
        POLL_INTERVAL_MS
      );
    } catch (err) {
      setGenStatus("error");
      setGenError(err instanceof Error ? err.message : "Submit error.");
    }
  }, [promptText, images, slot.slotKey, slot.resolution, slot.durationSeconds, pollGen, stopGenPoll]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const genRunning = ["submitting", "generating", "saving"].includes(genStatus);
  const genLabel =
    genStatus === "submitting"
      ? "Submitting to Seedance…"
      : genStatus === "generating"
      ? "Generating 8-second reel…"
      : genStatus === "saving"
      ? "Saving to library…"
      : "";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="w-full border border-neutral-800 rounded-2xl bg-neutral-950 overflow-hidden">
      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-6 py-4 border-b border-neutral-800 bg-neutral-900/50">
        <input
          type="text"
          value={slotName}
          onChange={(e) => setSlotName(e.target.value)}
          className="flex-1 bg-transparent text-white font-semibold text-base outline-none border-b border-transparent hover:border-neutral-700 focus:border-neutral-500 transition-colors pb-0.5 min-w-0"
          placeholder="Slot name"
        />
        <div className="flex items-center gap-3 shrink-0">
          {/* Time */}
          <input
            type="time"
            value={scheduledTime}
            onChange={(e) => setScheduledTime(e.target.value)}
            className="text-sm text-white bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-neutral-600 [color-scheme:dark] cursor-pointer"
          />
          {/* Enabled toggle */}
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled((v) => !v)}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none cursor-pointer ${
              enabled ? "bg-emerald-500" : "bg-neutral-700"
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200 ${
                enabled ? "translate-x-4" : "translate-x-1"
              }`}
            />
          </button>
          <span className={`text-xs font-medium ${enabled ? "text-emerald-400" : "text-neutral-600"}`}>
            {enabled ? "Enabled" : "Disabled"}
          </span>
        </div>
      </div>

      <div className="px-6 py-5 flex flex-col gap-5">
        {/* Image chips */}
        <div className="flex flex-wrap items-center gap-2">
          {images.map((img) => (
            <div
              key={img.path}
              className="group relative flex items-center gap-1.5 bg-neutral-800 border border-neutral-700 rounded-lg overflow-hidden"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt={img.name}
                className="w-10 h-10 object-cover"
              />
              <span className="text-xs text-neutral-400 pr-2 max-w-[80px] truncate">
                {img.name}
              </span>
              <button
                type="button"
                onClick={() => void handleRemoveImage(img.path)}
                disabled={removingPath === img.path}
                className="absolute top-0 right-0 w-5 h-5 flex items-center justify-center bg-black/70 text-neutral-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity rounded-bl text-xs"
              >
                {removingPath === img.path ? "…" : "×"}
              </button>
            </div>
          ))}

          {/* Add image button */}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleImageFileChange}
          />
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            disabled={uploadingImage}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-neutral-700 text-xs text-neutral-500 hover:text-neutral-300 hover:border-neutral-500 transition-colors disabled:opacity-50"
          >
            {uploadingImage ? (
              <>
                <span className="w-3 h-3 border border-neutral-600 border-t-white rounded-full animate-spin inline-block" />
                Uploading…
              </>
            ) : (
              <>
                <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" />
                </svg>
                Add Image
              </>
            )}
          </button>
          {uploadError && (
            <span className="text-xs text-red-400">{uploadError}</span>
          )}
        </div>

        {/* Prompt textarea */}
        <textarea
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          rows={6}
          placeholder="Describe your scene in detail. Use @ to reference attached images."
          className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 text-sm text-neutral-200 placeholder-neutral-600 resize-y outline-none focus:border-neutral-600 focus:ring-1 focus:ring-neutral-700 transition-colors leading-relaxed"
        />

        {/* Settings pills */}
        <div className="flex flex-wrap items-center gap-2">
          {[
            { label: "Model", value: slot.model },
            { label: "Duration", value: `${slot.durationSeconds}s` },
            { label: "Aspect", value: slot.aspectRatio },
            { label: "Resolution", value: slot.resolution },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-800 bg-neutral-900"
            >
              <span className="text-[10px] text-neutral-600 uppercase tracking-widest">
                {label}
              </span>
              <span className="text-xs text-neutral-400 font-medium">{value}</span>
            </div>
          ))}
        </div>

        {/* Action row */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button
            type="button"
            onClick={handleGenerateTest}
            disabled={genRunning}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-neutral-700 bg-neutral-900 text-sm text-neutral-300 hover:bg-neutral-800 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {genRunning ? (
              <>
                <span className="w-3 h-3 border border-neutral-600 border-t-white rounded-full animate-spin inline-block" />
                {genLabel || "In progress…"}
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                </svg>
                Generate Test
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={saveStatus === "saving"}
            className="px-5 py-2 rounded-lg bg-white text-black text-sm font-semibold hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saveStatus === "saving"
              ? "Saving…"
              : saveStatus === "saved"
              ? "Saved ✓"
              : "Save Slot"}
          </button>
        </div>

        {/* Save error */}
        {saveStatus === "error" && saveError && (
          <p className="text-xs text-red-400">{saveError}</p>
        )}

        {/* Generation error */}
        {genStatus === "error" && genError && (
          <div className="rounded-lg border border-red-900 bg-red-950/30 px-4 py-3">
            <p className="text-xs text-red-400">{genError}</p>
          </div>
        )}

        {/* Test video result */}
        {genStatus === "done" && testVideoUrl && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-emerald-400">
                Test generation complete — saved to library ✓
              </span>
              <button
                type="button"
                onClick={() => setShowTestVideo((v) => !v)}
                className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                {showTestVideo ? "Hide ↑" : "Show video ↓"}
              </button>
            </div>
            {showTestVideo && (
              <div className="w-full max-w-[200px] mx-auto rounded-xl overflow-hidden border border-neutral-700">
                <div className="relative w-full" style={{ aspectRatio: "9 / 16" }}>
                  <video
                    src={testVideoUrl}
                    controls
                    playsInline
                    autoPlay
                    className="absolute inset-0 w-full h-full object-contain bg-black"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
