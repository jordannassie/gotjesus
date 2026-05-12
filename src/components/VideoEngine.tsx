"use client";

import { useState, useRef, useCallback } from "react";
import type { PostingSettings } from "@/lib/posting-settings";

// ─── Types ────────────────────────────────────────────────────────────────────

type GenerationState =
  | "idle"
  | "submitting"
  | "waiting"
  | "queuing"
  | "generating"
  | "success"
  | "failed";

type FinalizationState =
  | "idle"
  | "starting"
  | "pending"
  | "processing"
  | "appending_endcard"
  | "uploading"
  | "complete"
  | "failed";

interface VideoEngineProps {
  blotatoConnected: boolean;
  promptSummary: string;
  fullPrompt: string;
  resolution: string;
  initialSettings: PostingSettings;
}

// ─── Labels ───────────────────────────────────────────────────────────────────

const GEN_LABELS: Record<GenerationState, string> = {
  idle: "Generate Video",
  submitting: "Submitting to Seedance...",
  waiting: "Generating video...",
  queuing: "Generating video...",
  generating: "Generating video...",
  success: "Generate Video",
  failed: "Generate Video",
};

const FINAL_LABELS: Record<FinalizationState, string> = {
  idle: "Create Final Reel",
  starting: "Starting...",
  pending: "Preparing final reel...",
  processing: "Processing video...",
  appending_endcard: "Appending Got Jesus end card...",
  uploading: "Uploading final MP4...",
  complete: "Final reel ready",
  failed: "Retry Final Reel",
};

const POLL_INTERVAL_MS = 6000;
const MAX_GEN_POLLS = 120; // 12 min
const MAX_FINAL_POLLS = 180; // 18 min

// Default posting times by posts-per-day count
const DEFAULT_TIMES: Record<number, string[]> = {
  1: ["12:00"],
  2: ["09:00", "19:00"],
  3: ["09:00", "13:00", "19:00"],
  4: ["08:00", "12:00", "17:00", "21:00"],
  5: ["08:00", "11:00", "14:00", "17:00", "20:00"],
};

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none
        ${checked ? "bg-emerald-500" : "bg-neutral-700"}
        ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200
          ${checked ? "translate-x-4" : "translate-x-1"}`}
      />
    </button>
  );
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="inline-block w-4 h-4 border-2 border-neutral-600 border-t-white rounded-full animate-spin shrink-0" />
      <span className="text-sm text-neutral-400">{label}</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function VideoEngine({
  blotatoConnected,
  promptSummary,
  fullPrompt,
  resolution,
  initialSettings,
}: VideoEngineProps) {
  // Generation
  const [genState, setGenState] = useState<GenerationState>("idle");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [rawVideoUrl, setRawVideoUrl] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  // Finalization
  const [finalState, setFinalState] = useState<FinalizationState>("idle");
  const [finalJobId, setFinalJobId] = useState<string | null>(null);
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [finalError, setFinalError] = useState<string | null>(null);

  // Post toggles — initialized from saved settings
  const [autoPost, setAutoPost] = useState(initialSettings.autoPostEnabled);
  const [postInstagram, setPostInstagram] = useState(initialSettings.instagramEnabled);
  const [postTiktok, setPostTiktok] = useState(initialSettings.tiktokEnabled);
  const [postYoutube, setPostYoutube] = useState(initialSettings.youtubeEnabled);

  // Schedule settings — initialized from saved settings
  const [postsPerDay, setPostsPerDay] = useState(initialSettings.postsPerDay);
  const [postingTimes, setPostingTimes] = useState<string[]>(
    initialSettings.postingTimes.length > 0
      ? initialSettings.postingTimes
      : DEFAULT_TIMES[initialSettings.postsPerDay] ?? DEFAULT_TIMES[3]
  );

  // Schedule save state
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Copy prompt state
  const [promptCopied, setPromptCopied] = useState(false);

  // Advanced section
  const [showAdvanced, setShowAdvanced] = useState(false);

  const genTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const genPollCount = useRef(0);
  const finalPollCount = useRef(0);

  // ─── Posts-per-day change ──────────────────────────────────────────────────

  const handlePostsPerDayChange = useCallback((n: number) => {
    setPostsPerDay(n);
    setPostingTimes(DEFAULT_TIMES[n] ?? DEFAULT_TIMES[3]);
    setSaved(false);
  }, []);

  // ─── Save schedule ─────────────────────────────────────────────────────────

  const handleSaveSchedule = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const res = await fetch("/api/posting-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autoPostEnabled: autoPost,
          instagramEnabled: postInstagram,
          tiktokEnabled: postTiktok,
          youtubeEnabled: postYoutube,
          postsPerDay,
          postingTimes,
          timezone: "America/Los_Angeles",
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }, [autoPost, postInstagram, postTiktok, postYoutube, postsPerDay, postingTimes]);

  // ─── Copy full prompt ──────────────────────────────────────────────────────

  const handleCopyPrompt = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(fullPrompt);
    } catch {
      // Fallback for environments where clipboard API is unavailable
      const ta = document.createElement("textarea");
      ta.value = fullPrompt;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2000);
  }, [fullPrompt]);

  // ─── Generation polling ────────────────────────────────────────────────────

  const stopGenPoll = useCallback(() => {
    if (genTimer.current) {
      clearTimeout(genTimer.current);
      genTimer.current = null;
    }
  }, []);

  const pollGen = useCallback(
    async (id: string) => {
      if (genPollCount.current >= MAX_GEN_POLLS) {
        stopGenPoll();
        setGenState("failed");
        setGenError("Generation timed out after 12 minutes.");
        return;
      }
      genPollCount.current += 1;

      try {
        const res = await fetch(`/api/generate-video?taskId=${id}`);
        const data = (await res.json()) as {
          state?: string;
          videoUrl?: string | null;
          failMsg?: string | null;
          error?: string;
        };

        if (!res.ok || data.error) {
          stopGenPoll();
          setGenState("failed");
          setGenError(data.error ?? "Unknown server error.");
          return;
        }

        const raw = data.state as string;
        if (raw === "success") {
          stopGenPoll();
          setGenState("success");
          setRawVideoUrl(data.videoUrl ?? null);
          return;
        }
        if (raw === "fail") {
          stopGenPoll();
          setGenState("failed");
          setGenError(data.failMsg ?? "Kie.ai reported generation failure.");
          return;
        }

        setGenState(raw as GenerationState);
        genTimer.current = setTimeout(() => pollGen(id), POLL_INTERVAL_MS);
      } catch (err) {
        stopGenPoll();
        setGenState("failed");
        setGenError(err instanceof Error ? err.message : "Polling error.");
      }
    },
    [stopGenPoll]
  );

  const handleGenerate = useCallback(async () => {
    stopGenPoll();
    setGenState("submitting");
    setTaskId(null);
    setRawVideoUrl(null);
    setGenError(null);
    setFinalState("idle");
    setFinalJobId(null);
    setFinalVideoUrl(null);
    setFinalError(null);
    genPollCount.current = 0;

    try {
      const res = await fetch("/api/generate-video", { method: "POST" });
      const data = (await res.json()) as { taskId?: string; error?: string };

      if (!res.ok || data.error) {
        setGenState("failed");
        setGenError(data.error ?? "Failed to submit task.");
        return;
      }

      const id = data.taskId!;
      setTaskId(id);
      setGenState("waiting");
      genTimer.current = setTimeout(() => pollGen(id), POLL_INTERVAL_MS);
    } catch (err) {
      setGenState("failed");
      setGenError(err instanceof Error ? err.message : "Submit error.");
    }
  }, [pollGen, stopGenPoll]);

  // ─── Finalization polling ──────────────────────────────────────────────────

  const stopFinalPoll = useCallback(() => {
    if (finalTimer.current) {
      clearTimeout(finalTimer.current);
      finalTimer.current = null;
    }
  }, []);

  const pollFinal = useCallback(
    async (id: string) => {
      if (finalPollCount.current >= MAX_FINAL_POLLS) {
        stopFinalPoll();
        setFinalState("failed");
        setFinalError("Finalization timed out after 18 minutes.");
        return;
      }
      finalPollCount.current += 1;

      try {
        const res = await fetch(`/api/finalize-video?jobId=${id}`);
        const data = (await res.json()) as {
          status?: string;
          url?: string | null;
          error?: string | null;
        };

        if (!res.ok || data.error) {
          stopFinalPoll();
          setFinalState("failed");
          setFinalError(data.error ?? "Finalization error.");
          return;
        }

        const s = data.status as FinalizationState;

        if (s === "complete") {
          stopFinalPoll();
          setFinalState("complete");
          setFinalVideoUrl(data.url ?? null);
          return;
        }

        if (s === "failed") {
          stopFinalPoll();
          setFinalState("failed");
          setFinalError("Finalization failed on the server.");
          return;
        }

        setFinalState(s);
        finalTimer.current = setTimeout(() => pollFinal(id), POLL_INTERVAL_MS);
      } catch (err) {
        stopFinalPoll();
        setFinalState("failed");
        setFinalError(err instanceof Error ? err.message : "Polling error.");
      }
    },
    [stopFinalPoll]
  );

  const handleFinalize = useCallback(async () => {
    if (!rawVideoUrl) return;

    stopFinalPoll();
    setFinalState("starting");
    setFinalJobId(null);
    setFinalVideoUrl(null);
    setFinalError(null);
    finalPollCount.current = 0;

    try {
      const res = await fetch("/api/finalize-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawVideoUrl }),
      });
      const data = (await res.json()) as { jobId?: string; error?: string };

      if (!res.ok || data.error) {
        setFinalState("failed");
        setFinalError(data.error ?? "Failed to start finalization.");
        return;
      }

      const id = data.jobId!;
      setFinalJobId(id);
      setFinalState("pending");
      finalTimer.current = setTimeout(() => pollFinal(id), POLL_INTERVAL_MS);
    } catch (err) {
      setFinalState("failed");
      setFinalError(err instanceof Error ? err.message : "Start error.");
    }
  }, [rawVideoUrl, pollFinal, stopFinalPoll]);

  // ─── Derived ───────────────────────────────────────────────────────────────

  const genRunning = ["submitting", "waiting", "queuing", "generating"].includes(genState);
  const finalRunning = [
    "starting",
    "pending",
    "processing",
    "appending_endcard",
    "uploading",
  ].includes(finalState);

  const statusRows = [
    { label: "Kie.ai Seedance 2.0", status: "Connected", active: true },
    { label: "Got Jesus? Logo End Card", status: "Asset Ready", active: true },
    {
      label: "Blotato Social Posting",
      status: blotatoConnected ? "Connected" : "Not Connected Yet",
      active: blotatoConnected,
    },
  ];

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="w-full flex flex-col gap-6">
      {/* ── Engine status card ── */}
      <div className="w-full border border-neutral-800 rounded-2xl p-8 flex flex-col gap-6 bg-neutral-950">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-wide text-white">
            Cross Discovery Video Engine
          </h2>
          <p className="text-xs text-neutral-500">
            Kie.ai Seedance 2.0 Fast — 9:16 vertical — {resolution} — 7 sec
            montage + 1 sec end card
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {statusRows.map(({ label, status, active }) => (
            <div
              key={label}
              className="flex items-center justify-between py-3 px-4 rounded-lg border border-neutral-800 bg-neutral-900"
            >
              <span className="text-sm text-neutral-300">{label}</span>
              <span
                className={`text-xs font-medium ${
                  active ? "text-emerald-500" : "text-neutral-500"
                }`}
              >
                {status}
              </span>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={genRunning}
          className="w-full py-3 px-6 rounded-lg bg-white text-black text-sm font-semibold tracking-wide hover:bg-neutral-200 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {genRunning ? GEN_LABELS[genState] : "Generate Video"}
        </button>

        {genRunning && <Spinner label={GEN_LABELS[genState]} />}

        {genState === "failed" && genError && (
          <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3">
            <p className="text-xs text-red-400 leading-relaxed">
              <span className="font-semibold text-red-300">Error: </span>
              {genError}
            </p>
          </div>
        )}

        {taskId && (
          <p className="text-xs text-neutral-700 font-mono">task: {taskId}</p>
        )}
      </div>

      {/* ── Raw video preview (shown once generation succeeds) ── */}
      {genState === "success" && rawVideoUrl && (
        <div className="w-full border border-neutral-800 rounded-2xl p-8 flex flex-col gap-5 bg-neutral-950">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-wide text-white">
              Raw Montage Preview
            </h2>
            <span className="text-xs font-medium text-emerald-500">
              Video ready
            </span>
          </div>

          <div className="w-full rounded-xl overflow-hidden border border-neutral-700">
            <div className="relative w-full" style={{ aspectRatio: "9 / 16" }}>
              <video
                src={rawVideoUrl}
                controls
                autoPlay
                loop
                playsInline
                className="absolute inset-0 w-full h-full object-contain bg-black"
              />
            </div>
          </div>

          <div className="rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3">
            <p className="text-xs text-neutral-400 leading-relaxed">
              <span className="text-neutral-300 font-medium">Next step: </span>
              Official Got Jesus end card will be appended in the finalization
              step below.
            </p>
          </div>

          <p className="text-xs text-neutral-700 font-mono break-all">
            {rawVideoUrl}
          </p>

          {/* Create Final Reel button */}
          <button
            type="button"
            onClick={handleFinalize}
            disabled={finalRunning}
            className="w-full py-3 px-6 rounded-lg bg-white text-black text-sm font-semibold tracking-wide hover:bg-neutral-200 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {finalRunning
              ? FINAL_LABELS[finalState]
              : FINAL_LABELS[
                  finalState === "complete" || finalState === "failed"
                    ? finalState
                    : "idle"
                ]}
          </button>

          {finalRunning && <Spinner label={FINAL_LABELS[finalState]} />}

          {finalState === "failed" && finalError && (
            <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3">
              <p className="text-xs text-red-400 leading-relaxed">
                <span className="font-semibold text-red-300">Error: </span>
                {finalError}
              </p>
            </div>
          )}

          {finalJobId && (
            <p className="text-xs text-neutral-700 font-mono">
              job: {finalJobId}
            </p>
          )}
        </div>
      )}

      {/* ── Final reel section (shown once finalization succeeds) ── */}
      {finalState === "complete" && finalVideoUrl && (
        <div className="w-full border border-neutral-800 rounded-2xl p-8 flex flex-col gap-5 bg-neutral-950">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-wide text-white">
              Final Reel
            </h2>
            <span className="text-xs font-medium text-emerald-500">
              Final reel ready
            </span>
          </div>

          <div className="w-full rounded-xl overflow-hidden border border-neutral-700">
            <div className="relative w-full" style={{ aspectRatio: "9 / 16" }}>
              <video
                src={finalVideoUrl}
                controls
                autoPlay
                loop
                playsInline
                className="absolute inset-0 w-full h-full object-contain bg-black"
              />
            </div>
          </div>

          <div className="rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3">
            <p className="text-xs text-neutral-400 leading-relaxed">
              <span className="text-neutral-300 font-medium">
                8-second final reel:
              </span>{" "}
              7-second cross-discovery montage + 1-second Got Jesus end card.
              Saved to Supabase Storage.
            </p>
          </div>

          {/* Auto Post eligibility note */}
          {autoPost && blotatoConnected && (
            <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-4 py-3">
              <p className="text-xs text-amber-400/80 leading-relaxed">
                Auto Post is ON — this final reel is eligible to be sent to
                selected social platforms. Posting integration coming in the
                next step.
              </p>
            </div>
          )}

          <p className="text-xs text-neutral-700 font-mono break-all">
            {finalVideoUrl}
          </p>
        </div>
      )}

      {/* ── Social posting card ── */}
      <div className="w-full border border-neutral-800 rounded-2xl p-8 flex flex-col gap-5 bg-neutral-950">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-wide text-white">
            Social Posting
          </h2>
          <p className="text-xs text-neutral-500">
            {blotatoConnected
              ? "Blotato connected. Auto-post is off by default."
              : "Add Blotato env vars to enable social posting."}
          </p>
        </div>

        {/* Platform toggles */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between py-3 px-4 rounded-lg border border-neutral-800 bg-neutral-900">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-white">Auto Post</span>
              <span className="text-xs text-neutral-500">
                Post automatically when final reel is ready
              </span>
            </div>
            <Toggle
              checked={autoPost}
              onChange={() => {
                setAutoPost((v) => !v);
                setSaved(false);
              }}
              disabled={!blotatoConnected}
            />
          </div>

          {(
            [
              {
                key: "instagram",
                label: "Instagram",
                checked: postInstagram,
                set: setPostInstagram,
              },
              {
                key: "tiktok",
                label: "TikTok",
                checked: postTiktok,
                set: setPostTiktok,
              },
              {
                key: "youtube",
                label: "YouTube",
                checked: postYoutube,
                set: setPostYoutube,
              },
            ] as const
          ).map(({ key, label, checked, set }) => (
            <div
              key={key}
              className={`flex items-center justify-between py-3 px-4 rounded-lg border border-neutral-800 bg-neutral-900 transition-opacity duration-200 ${
                !blotatoConnected ? "opacity-40" : ""
              }`}
            >
              <span className="text-sm text-neutral-300">{label}</span>
              <Toggle
                checked={checked}
                onChange={() => {
                  set((v) => !v);
                  setSaved(false);
                }}
                disabled={!blotatoConnected}
              />
            </div>
          ))}
        </div>

        {!blotatoConnected && (
          <p className="text-xs text-neutral-600">
            Set BLOTATO_API_KEY and at least one platform account ID to enable
            posting.
          </p>
        )}

        {/* Divider */}
        <div className="border-t border-neutral-800" />

        {/* Automatic Posting Schedule */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-sm font-semibold text-white">
              Automatic Posting Schedule
            </h3>
            <p className="text-xs text-neutral-500">
              Configure how often and when reels are posted automatically.
            </p>
          </div>

          {/* Posts per day */}
          <div className="flex items-center justify-between py-3 px-4 rounded-lg border border-neutral-800 bg-neutral-900">
            <span className="text-sm text-neutral-300">Posts Per Day</span>
            <select
              value={postsPerDay}
              onChange={(e) => handlePostsPerDayChange(Number(e.target.value))}
              className="text-sm text-white bg-neutral-800 border border-neutral-700 rounded-md px-2 py-1 cursor-pointer outline-none focus:ring-1 focus:ring-neutral-600"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} per day
                </option>
              ))}
            </select>
          </div>

          {/* Posting times */}
          <div className="flex flex-col gap-2">
            <p className="text-xs text-neutral-500 px-1">Posting Times</p>
            {postingTimes.map((time, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between py-3 px-4 rounded-lg border border-neutral-800 bg-neutral-900"
              >
                <span className="text-sm text-neutral-300">
                  Post {idx + 1}
                </span>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => {
                    const updated = [...postingTimes];
                    updated[idx] = e.target.value;
                    setPostingTimes(updated);
                    setSaved(false);
                  }}
                  className="text-sm text-white bg-neutral-800 border border-neutral-700 rounded-md px-2 py-1 outline-none focus:ring-1 focus:ring-neutral-600 [color-scheme:dark] cursor-pointer"
                />
              </div>
            ))}
          </div>

          {/* Timezone note */}
          <p className="text-xs text-neutral-600 px-1">
            All automatic posting times use Pacific Time
            (America/Los_Angeles).
          </p>

          {/* Save button */}
          <button
            type="button"
            onClick={handleSaveSchedule}
            disabled={saving}
            className="w-full py-2.5 px-6 rounded-lg border border-neutral-700 bg-neutral-900 text-sm font-medium text-white hover:bg-neutral-800 hover:border-neutral-600 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : saved ? "Schedule saved ✓" : "Save Posting Schedule"}
          </button>

          {saveError && (
            <p className="text-xs text-red-400 px-1">{saveError}</p>
          )}
        </div>

        {/* Auto Post active banner */}
        {autoPost && blotatoConnected && (
          <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-4 py-3">
            <p className="text-xs text-amber-400/80 leading-relaxed">
              Auto Post is ON — final reels can be sent to selected social
              platforms. Posting integration coming in the next step.
            </p>
          </div>
        )}
      </div>

      {/* ── Advanced collapsible ── */}
      <div className="w-full border border-neutral-800 rounded-2xl overflow-hidden bg-neutral-950">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="w-full flex items-center justify-between px-8 py-4 text-left hover:bg-neutral-900 transition-colors duration-150"
        >
          <span className="text-sm font-medium text-neutral-400">Advanced</span>
          <span className="text-xs text-neutral-600">
            {showAdvanced ? "Hide" : "Show"}
          </span>
        </button>

        {showAdvanced && (
          <div className="px-8 pb-8 flex flex-col gap-5 border-t border-neutral-800">
            {/* Prompt summary */}
            <div className="flex flex-col gap-1.5 pt-5">
              <p className="text-xs font-medium text-neutral-400">
                Prompt Summary
              </p>
              <p className="text-xs text-neutral-500 leading-relaxed">
                {promptSummary}
              </p>
            </div>

            {/* Full prompt */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-neutral-400">
                  Full Generation Prompt
                </p>
                <button
                  type="button"
                  onClick={handleCopyPrompt}
                  className="text-xs px-3 py-1.5 rounded-md border border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800 hover:text-white hover:border-neutral-600 transition-colors duration-150"
                >
                  {promptCopied ? "Copied ✓" : "Copy Full Prompt"}
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900/60 p-4 scroll-smooth">
                <pre className="text-xs text-neutral-400 whitespace-pre-wrap font-mono leading-relaxed">
                  {fullPrompt}
                </pre>
              </div>
              <p className="text-xs text-neutral-700">
                Source:{" "}
                <span className="font-mono">src/lib/cross-prompt.ts</span>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
