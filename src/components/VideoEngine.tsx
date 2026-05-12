"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { PostingSettings } from "@/lib/posting-settings";
import type { Reel } from "@/lib/reels-db";

// ─── Types ────────────────────────────────────────────────────────────────────

type GenerationState =
  | "idle"
  | "submitting"
  | "waiting"
  | "queuing"
  | "generating"
  | "success"
  | "failed";

type SaveState = "idle" | "saving" | "posting" | "complete" | "failed";

interface VideoEngineProps {
  blotatoConnected: boolean;
  promptSummary: string;
  fullPrompt: string;
  resolution: string;
  initialSettings: PostingSettings;
}

// ─── Status labels ─────────────────────────────────────────────────────────────

function getProgressLabel(
  genState: GenerationState,
  saveState: SaveState
): string {
  if (genState === "submitting") return "Submitting to Seedance...";
  if (["waiting", "queuing", "generating"].includes(genState))
    return "Generating branded 8-second reel...";
  if (saveState === "saving") return "Saving video to library...";
  if (saveState === "posting") return "Posting to social platforms...";
  return "";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

const POLL_INTERVAL_MS = 6000;
const MAX_GEN_POLLS = 120; // 12 min
const MAX_SAVE_POLLS = 60; // 6 min

const STATUS_COLORS: Record<string, string> = {
  generating: "text-sky-400",
  saving: "text-sky-400",
  ready: "text-emerald-400",
  posting: "text-amber-400",
  scheduled: "text-violet-400",
  posted: "text-emerald-400",
  failed: "text-red-400",
};

const DEFAULT_TIMES: Record<number, string[]> = {
  1: ["12:00"],
  2: ["09:00", "19:00"],
  3: ["09:00", "13:00", "19:00"],
  4: ["08:00", "12:00", "17:00", "21:00"],
  5: ["08:00", "11:00", "14:00", "17:00", "20:00"],
};

// ─── Sub-components ───────────────────────────────────────────────────────────

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

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="inline-block w-4 h-4 border-2 border-neutral-600 border-t-white rounded-full animate-spin shrink-0" />
      <span className="text-sm text-neutral-400">{label}</span>
    </div>
  );
}

function PlatformBadge({
  label,
  active,
}: {
  label: string;
  active: boolean;
}) {
  if (!active) return null;
  return (
    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium border border-neutral-700 bg-neutral-800 text-neutral-300">
      {label}
    </span>
  );
}

// ─── PlatformRow ─────────────────────────────────────────────────────────────

function PlatformRow({
  label,
  status,
  submissionId,
  publicUrl,
  error,
}: {
  label: string;
  status: string | null;
  submissionId: string | null;
  publicUrl: string | null;
  error: string | null;
}) {
  const statusLabel = error
    ? "Failed"
    : submissionId
    ? status ?? "Submitted"
    : "Not sent";

  const statusColor = error
    ? "text-red-400"
    : submissionId
    ? "text-emerald-400"
    : "text-neutral-600";

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <span className="text-xs text-neutral-500 w-20 shrink-0">{label}:</span>
        <span className={`text-xs font-medium ${statusColor}`}>{statusLabel}</span>
        {publicUrl && (
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-sky-500 hover:text-sky-400 underline"
          >
            View
          </a>
        )}
      </div>
      {submissionId && submissionId !== "unknown" && (
        <p className="text-xs text-neutral-700 font-mono pl-22 leading-relaxed">
          ID: {submissionId}
        </p>
      )}
      {error && (
        <p className="text-xs text-red-400/70 pl-22 leading-relaxed">{error}</p>
      )}
    </div>
  );
}

// ─── Reel Library Card ────────────────────────────────────────────────────────

function ReelCard({
  reel,
  onDelete,
  deleting,
}: {
  reel: Reel;
  onDelete: (id: string) => void;
  deleting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const displayUrl = reel.saved_video_url ?? reel.kie_video_url;
  const statusColor = STATUS_COLORS[reel.status] ?? "text-neutral-400";
  const wasPosted =
    reel.instagram_post_submission_id ||
    reel.tiktok_post_submission_id ||
    reel.youtube_post_submission_id;

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-semibold ${statusColor}`}>
              {reel.status.charAt(0).toUpperCase() + reel.status.slice(1)}
            </span>
            <span className="text-xs text-neutral-600">·</span>
            <span className="text-xs text-neutral-500">
              {reel.generation_source === "scheduled" ? "Scheduled" : "Manual"}
            </span>
            <span className="text-xs text-neutral-600">·</span>
            <span className="text-xs text-neutral-500">
              {formatDate(reel.created_at)}
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <PlatformBadge label="Instagram" active={reel.instagram_enabled} />
            <PlatformBadge label="TikTok" active={reel.tiktok_enabled} />
            <PlatformBadge label="YouTube" active={reel.youtube_enabled} />
          </div>
        </div>
        <button
          type="button"
          onClick={() => onDelete(reel.id)}
          disabled={deleting}
          className="shrink-0 text-xs text-neutral-600 hover:text-red-400 transition-colors duration-150 disabled:opacity-40"
        >
          {deleting ? "..." : "Delete"}
        </button>
      </div>

      {/* Per-platform posting detail */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-neutral-500">
          Manual posting:{" "}
          <span
            className={
              wasPosted
                ? "text-emerald-400 font-medium"
                : reel.blotato_status === "failed"
                ? "text-red-400 font-medium"
                : "text-neutral-600"
            }
          >
            {wasPosted
              ? "Submitted to Blotato"
              : reel.blotato_status === "failed"
              ? "Failed to submit"
              : "Not requested"}
          </span>
        </span>

        {(reel.instagram_enabled || reel.tiktok_enabled || reel.youtube_enabled) && (
          <div className="flex flex-col gap-0.5 pl-2 border-l border-neutral-800">
            {reel.instagram_enabled && (
              <PlatformRow
                label="Instagram"
                status={reel.instagram_post_status}
                submissionId={reel.instagram_post_submission_id}
                publicUrl={reel.instagram_post_url}
                error={reel.instagram_error}
              />
            )}
            {reel.tiktok_enabled && (
              <PlatformRow
                label="TikTok"
                status={reel.tiktok_post_status}
                submissionId={reel.tiktok_post_submission_id}
                publicUrl={reel.tiktok_post_url}
                error={reel.tiktok_error}
              />
            )}
            {reel.youtube_enabled && (
              <PlatformRow
                label="YouTube"
                status={reel.youtube_post_status}
                submissionId={reel.youtube_post_submission_id}
                publicUrl={reel.youtube_post_url}
                error={reel.youtube_error}
              />
            )}
          </div>
        )}
      </div>

      {reel.scheduled_for && (
        <p className="text-xs text-violet-400/80">
          Scheduled for {formatDate(reel.scheduled_for)}
        </p>
      )}

      {reel.error_message && (
        <p className="text-xs text-red-400/80 leading-relaxed">
          {reel.error_message}
        </p>
      )}

      {displayUrl && (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-neutral-500 hover:text-neutral-300 text-left transition-colors"
          >
            {expanded ? "Hide video ↑" : "Show video ↓"}
          </button>
          {expanded && (
            <div className="w-full rounded-lg overflow-hidden border border-neutral-700">
              <div
                className="relative w-full"
                style={{ aspectRatio: "9 / 16" }}
              >
                <video
                  src={displayUrl}
                  controls
                  playsInline
                  className="absolute inset-0 w-full h-full object-contain bg-black"
                />
              </div>
            </div>
          )}
          {reel.saved_video_url && (
            <p className="text-xs text-neutral-700 font-mono break-all leading-relaxed">
              {reel.saved_video_url}
            </p>
          )}
        </>
      )}
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
  // ── Generation state ───────────────────────────────────────────────────────
  const [genState, setGenState] = useState<GenerationState>("idle");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [kieVideoUrl, setKieVideoUrl] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  // ── Save / post state ──────────────────────────────────────────────────────
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [reelId, setReelId] = useState<string | null>(null);
  const [savedVideoUrl, setSavedVideoUrl] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Social posting — initialized from saved settings ───────────────────────
  /** autoPost controls the SCHEDULED daily engine only */
  const [autoPost, setAutoPost] = useState(initialSettings.autoPostEnabled);
  /** manualPost controls whether Generate Video clicks post immediately */
  const [manualPost, setManualPost] = useState(
    initialSettings.manualPostEnabled
  );
  const [postInstagram, setPostInstagram] = useState(
    initialSettings.instagramEnabled
  );
  const [postTiktok, setPostTiktok] = useState(initialSettings.tiktokEnabled);
  const [postYoutube, setPostYoutube] = useState(
    initialSettings.youtubeEnabled
  );

  // ── Schedule settings ──────────────────────────────────────────────────────
  const [postsPerDay, setPostsPerDay] = useState(initialSettings.postsPerDay);
  const [postingTimes, setPostingTimes] = useState<string[]>(
    initialSettings.postingTimes.length > 0
      ? initialSettings.postingTimes
      : (DEFAULT_TIMES[initialSettings.postsPerDay] ?? DEFAULT_TIMES[3])
  );

  // ── Schedule save state ────────────────────────────────────────────────────
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleSaved, setScheduleSaved] = useState(false);
  const [scheduleSaveError, setScheduleSaveError] = useState<string | null>(
    null
  );

  // ── Reel library ───────────────────────────────────────────────────────────
  const [reels, setReels] = useState<Reel[]>([]);
  const [reelsLoading, setReelsLoading] = useState(false);
  const [reelDeleteId, setReelDeleteId] = useState<string | null>(null);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [promptCopied, setPromptCopied] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const genTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const genPollCount = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savePollCount = useRef(0);

  // ─── Reel library ──────────────────────────────────────────────────────────

  const fetchReels = useCallback(async () => {
    setReelsLoading(true);
    try {
      const res = await fetch("/api/reels");
      if (res.ok) {
        const data = (await res.json()) as Reel[];
        setReels(data);
      }
    } catch {
      // silently fail
    } finally {
      setReelsLoading(false);
    }
  }, []);

  // Fetch reel library on mount
  useEffect(() => {
    fetchReels();
  }, [fetchReels]);

  const handleDeleteReel = useCallback(
    async (id: string) => {
      setReelDeleteId(id);
      try {
        await fetch(`/api/reels?reelId=${id}`, { method: "DELETE" });
        await fetchReels();
      } catch {
        // ignore
      } finally {
        setReelDeleteId(null);
      }
    },
    [fetchReels]
  );

  // ─── Posts-per-day change ──────────────────────────────────────────────────

  const handlePostsPerDayChange = useCallback((n: number) => {
    setPostsPerDay(n);
    setPostingTimes(DEFAULT_TIMES[n] ?? DEFAULT_TIMES[3]);
    setScheduleSaved(false);
  }, []);

  // ─── Save schedule ─────────────────────────────────────────────────────────

  const handleSaveSchedule = useCallback(async () => {
    setScheduleSaving(true);
    setScheduleSaved(false);
    setScheduleSaveError(null);
    try {
      const res = await fetch("/api/posting-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autoPostEnabled: autoPost,
          manualPostEnabled: manualPost,
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
      setScheduleSaved(true);
      setTimeout(() => setScheduleSaved(false), 2500);
    } catch (err) {
      setScheduleSaveError(
        err instanceof Error ? err.message : "Save failed."
      );
    } finally {
      setScheduleSaving(false);
    }
  }, [
    autoPost,
    manualPost,
    postInstagram,
    postTiktok,
    postYoutube,
    postsPerDay,
    postingTimes,
  ]);

  // ─── Copy full prompt ──────────────────────────────────────────────────────

  const handleCopyPrompt = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(fullPrompt);
    } catch {
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

  // ─── Save polling ──────────────────────────────────────────────────────────

  const stopSavePoll = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, []);

  const pollSave = useCallback(
    async (id: string) => {
      if (savePollCount.current >= MAX_SAVE_POLLS) {
        stopSavePoll();
        setSaveState("failed");
        setSaveError(
          "Save timed out — the background function did not complete within 6 minutes. " +
          "Check Netlify function logs for save-reel-background."
        );
        return;
      }
      savePollCount.current += 1;

      try {
        const res = await fetch(`/api/save-reel?reelId=${id}`);
        const data = (await res.json()) as {
          status?: string;
          saved_video_url?: string | null;
          error_message?: string | null;
        };

        const status = data.status ?? "saving";

        if (
          status === "ready" ||
          status === "posted" ||
          status === "scheduled"
        ) {
          stopSavePoll();
          setSaveState("complete");
          setSavedVideoUrl(data.saved_video_url ?? null);
          void fetchReels();
          return;
        }

        if (status === "failed") {
          stopSavePoll();
          setSaveState("failed");
          setSaveError(
            data.error_message ?? "Save failed on server."
          );
          return;
        }

        if (status === "posting") setSaveState("posting");

        saveTimer.current = setTimeout(
          () => void pollSave(id),
          POLL_INTERVAL_MS
        );
      } catch (err) {
        stopSavePoll();
        setSaveState("failed");
        setSaveError(err instanceof Error ? err.message : "Poll error.");
      }
    },
    [stopSavePoll, fetchReels]
  );

  // ─── Save reel after Kie generation ───────────────────────────────────────

  const handleSaveReel = useCallback(
    async (kieUrl: string) => {
      stopSavePoll();
      setSaveState("saving");
      setReelId(null);
      setSavedVideoUrl(null);
      setSaveError(null);
      savePollCount.current = 0;

      // manualPost drives immediate posting for Generate Video clicks.
      // autoPost is for the scheduled daily engine only — not used here.
      const enabledPlatforms: string[] = [];
      if (manualPost && postInstagram) enabledPlatforms.push("instagram");
      if (manualPost && postTiktok) enabledPlatforms.push("tiktok");
      if (manualPost && postYoutube) enabledPlatforms.push("youtube");

      try {
        const res = await fetch("/api/save-reel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kieVideoUrl: kieUrl,
            kieTaskId: taskId,
            autoPost: manualPost,
            platforms: enabledPlatforms,
          }),
        });
        const data = (await res.json()) as {
          reelId?: string;
          error?: string;
        };

        if (!res.ok || data.error) {
          setSaveState("failed");
          setSaveError(
            data.error ??
              `Save pipeline failed (HTTP ${res.status}). Check Netlify function logs.`
          );
          return;
        }

        const id = data.reelId!;
        setReelId(id);
        saveTimer.current = setTimeout(() => void pollSave(id), POLL_INTERVAL_MS);
      } catch (err) {
        setSaveState("failed");
        setSaveError(err instanceof Error ? err.message : "Save error.");
      }
    },
    [
      manualPost,
      postInstagram,
      postTiktok,
      postYoutube,
      taskId,
      pollSave,
      stopSavePoll,
    ]
  );

  // Auto-trigger save when Kie generation completes
  useEffect(() => {
    if (genState === "success" && kieVideoUrl && saveState === "idle") {
      void handleSaveReel(kieVideoUrl);
    }
  }, [genState, kieVideoUrl, saveState, handleSaveReel]);

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
          setKieVideoUrl(data.videoUrl ?? null);
          return;
        }

        if (raw === "fail") {
          stopGenPoll();
          setGenState("failed");
          setGenError(data.failMsg ?? "Kie.ai reported generation failure.");
          return;
        }

        setGenState(raw as GenerationState);
        genTimer.current = setTimeout(() => void pollGen(id), POLL_INTERVAL_MS);
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
    stopSavePoll();
    setGenState("submitting");
    setTaskId(null);
    setKieVideoUrl(null);
    setGenError(null);
    setSaveState("idle");
    setSavedVideoUrl(null);
    setSaveError(null);
    setReelId(null);
    genPollCount.current = 0;
    savePollCount.current = 0;

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
      genTimer.current = setTimeout(() => void pollGen(id), POLL_INTERVAL_MS);
    } catch (err) {
      setGenState("failed");
      setGenError(err instanceof Error ? err.message : "Submit error.");
    }
  }, [pollGen, stopGenPoll, stopSavePoll]);

  // ─── Derived ───────────────────────────────────────────────────────────────

  const genRunning = [
    "submitting",
    "waiting",
    "queuing",
    "generating",
  ].includes(genState);
  const saveRunning = ["saving", "posting"].includes(saveState);
  const isRunning = genRunning || saveRunning;
  const progressLabel = getProgressLabel(genState, saveState);

  // Show the saved Supabase URL if available, fall back to temp Kie URL
  const displayVideoUrl = savedVideoUrl ?? kieVideoUrl;
  const showResult =
    saveState === "complete" || (genState === "success" && kieVideoUrl !== null);

  const statusRows = [
    { label: "Kie.ai Seedance 2.0", status: "Connected", active: true },
    { label: "Got Jesus Branded Ending", status: "Active", active: true },
    { label: "Supabase Video Library", status: "Active", active: true },
    {
      label: "Blotato Social Posting",
      status: blotatoConnected ? "Connected" : "Not Connected",
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
            Kie.ai Seedance 2.0 Fast — 9:16 vertical — {resolution} — 8 sec
            with Got Jesus branded ending
          </p>
        </div>

        {/* Connection status rows */}
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

        {/* Generate Video button */}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isRunning}
          className="w-full py-3 px-6 rounded-lg bg-white text-black text-sm font-semibold tracking-wide hover:bg-neutral-200 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isRunning ? "In Progress..." : "Generate Video"}
        </button>

        {/* Progress spinner */}
        {isRunning && progressLabel && <Spinner label={progressLabel} />}

        {/* Generation error */}
        {genState === "failed" && genError && (
          <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3">
            <p className="text-xs text-red-400 leading-relaxed">
              <span className="font-semibold text-red-300">
                Generation failed:{" "}
              </span>
              {genError}
            </p>
          </div>
        )}

        {/* Save / post error */}
        {saveState === "failed" && saveError && (
          <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3">
            <p className="text-xs text-red-400 leading-relaxed">
              <span className="font-semibold text-red-300">Save failed: </span>
              {saveError}
            </p>
          </div>
        )}

        {/* Debug IDs */}
        {taskId && (
          <p className="text-xs text-neutral-700 font-mono">
            task: {taskId}
            {reelId ? ` · reel: ${reelId}` : ""}
          </p>
        )}
      </div>

      {/* ── Final video result ── */}
      {showResult && displayVideoUrl && (
        <div className="w-full border border-neutral-800 rounded-2xl p-8 flex flex-col gap-5 bg-neutral-950">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-wide text-white">
              Final Video
            </h2>
            <span className="text-xs font-medium text-emerald-500">
              {saveState === "complete" ? "Saved to library" : "Video ready"}
            </span>
          </div>

          {/* Main 9:16 player */}
          <div className="w-full rounded-xl overflow-hidden border border-neutral-700">
            <div className="relative w-full" style={{ aspectRatio: "9 / 16" }}>
              <video
                src={displayVideoUrl}
                controls
                autoPlay
                loop
                playsInline
                className="absolute inset-0 w-full h-full object-contain bg-black"
              />
            </div>
          </div>

          {/* Status note */}
          {saveState === "complete" && savedVideoUrl ? (
            <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 px-4 py-3">
              <p className="text-xs text-emerald-400/80 leading-relaxed">
                <span className="font-semibold text-emerald-300">
                  Saved to Supabase.{" "}
                </span>
                This reel is permanently stored and visible in the video library
                below.
                {manualPost && blotatoConnected && (
                  <span>
                    {" "}
                    Post Manual Generations is ON — posting to enabled platforms via Blotato.
                  </span>
                )}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-sky-900/50 bg-sky-950/20 px-4 py-3">
              <p className="text-xs text-sky-400/80 leading-relaxed">
                <span className="font-semibold text-sky-300">
                  Using Got Jesus branded image reference in Kie generation.{" "}
                </span>
                Seedance generated this 8-second reel with the Got Jesus end
                card provided as a reference image.
                {saveRunning && " Saving to permanent library..."}
              </p>
            </div>
          )}

          {/* Saved URL debug */}
          {savedVideoUrl && (
            <p className="text-xs text-neutral-700 font-mono break-all">
              {savedVideoUrl}
            </p>
          )}
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
              ? "Blotato connected. Enable Auto Post to publish reels automatically."
              : "Add Blotato env vars to enable social posting."}
          </p>
        </div>

        {/* Platform toggles */}
        <div className="flex flex-col gap-2">
          {/* Manual Generate Posting */}
          <div className="flex items-center justify-between py-3 px-4 rounded-lg border border-neutral-800 bg-neutral-900">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-white">
                Post Manual Generations
              </span>
              <span className="text-xs text-neutral-500">
                When ON, videos created by clicking Generate Video are posted
                immediately to selected platforms
              </span>
            </div>
            <Toggle
              checked={manualPost}
              onChange={() => {
                setManualPost((v) => !v);
                setScheduleSaved(false);
              }}
              disabled={!blotatoConnected}
            />
          </div>

          {/* Automatic Daily Posting */}
          <div className="flex items-center justify-between py-3 px-4 rounded-lg border border-neutral-800 bg-neutral-900">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-white">
                Automatic Daily Posting
              </span>
              <span className="text-xs text-neutral-500">
                Run the scheduled content engine at configured times each day
              </span>
            </div>
            <Toggle
              checked={autoPost}
              onChange={() => {
                setAutoPost((v) => !v);
                setScheduleSaved(false);
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
                  setScheduleSaved(false);
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

        {/* Active posting summary */}
        {blotatoConnected && (manualPost || autoPost) && (
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3 flex flex-col gap-1">
            {manualPost && (
              <p className="text-xs text-emerald-400/80">
                <span className="font-medium text-emerald-300">
                  Post Manual Generations ON
                </span>{" "}
                — Generate Video will post immediately to enabled platforms.
              </p>
            )}
            {autoPost && (
              <p className="text-xs text-violet-400/80">
                <span className="font-medium text-violet-300">
                  Automatic Daily Posting ON
                </span>{" "}
                — The scheduled engine will post at configured times.
              </p>
            )}
          </div>
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
              The daily scheduler generates and posts reels at the configured
              times.
            </p>
          </div>

          {/* Posts per day */}
          <div className="flex items-center justify-between py-3 px-4 rounded-lg border border-neutral-800 bg-neutral-900">
            <span className="text-sm text-neutral-300">Posts Per Day</span>
            <select
              value={postsPerDay}
              onChange={(e) =>
                handlePostsPerDayChange(Number(e.target.value))
              }
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
                <span className="text-sm text-neutral-300">Post {idx + 1}</span>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => {
                    const updated = [...postingTimes];
                    updated[idx] = e.target.value;
                    setPostingTimes(updated);
                    setScheduleSaved(false);
                  }}
                  className="text-sm text-white bg-neutral-800 border border-neutral-700 rounded-md px-2 py-1 outline-none focus:ring-1 focus:ring-neutral-600 [color-scheme:dark] cursor-pointer"
                />
              </div>
            ))}
          </div>

          <p className="text-xs text-neutral-600 px-1">
            All automatic posting times use Pacific Time
            (America/Los_Angeles). The daily scheduler runs at 5 AM PT.
          </p>

          {/* Save button */}
          <button
            type="button"
            onClick={handleSaveSchedule}
            disabled={scheduleSaving}
            className="w-full py-2.5 px-6 rounded-lg border border-neutral-700 bg-neutral-900 text-sm font-medium text-white hover:bg-neutral-800 hover:border-neutral-600 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {scheduleSaving
              ? "Saving..."
              : scheduleSaved
              ? "Schedule saved ✓"
              : "Save Posting Schedule"}
          </button>

          {scheduleSaveError && (
            <p className="text-xs text-red-400 px-1">{scheduleSaveError}</p>
          )}
        </div>
      </div>

      {/* ── Generated Videos library ── */}
      <div className="w-full border border-neutral-800 rounded-2xl p-8 flex flex-col gap-5 bg-neutral-950">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-lg font-semibold tracking-wide text-white">
              Generated Videos
            </h2>
            <p className="text-xs text-neutral-500">
              All reels saved to Supabase Storage.
            </p>
          </div>
          <button
            type="button"
            onClick={fetchReels}
            disabled={reelsLoading}
            className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors disabled:opacity-40"
          >
            {reelsLoading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {reels.length === 0 && !reelsLoading && (
          <p className="text-xs text-neutral-600">
            No reels yet. Generate a video to see it here.
          </p>
        )}

        {reels.length > 0 && (
          <div className="flex flex-col gap-3">
            {reels.map((reel) => (
              <ReelCard
                key={reel.id}
                reel={reel}
                onDelete={handleDeleteReel}
                deleting={reelDeleteId === reel.id}
              />
            ))}
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

            {/* Old pipeline note */}
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3">
              <p className="text-xs text-neutral-600 leading-relaxed">
                <span className="text-neutral-500 font-medium">
                  FFmpeg pipeline preserved:{" "}
                </span>
                The old end card assembly pipeline (
                <span className="font-mono">src/app/api/finalize-video</span>,{" "}
                <span className="font-mono">
                  netlify/functions/process-reel-background.ts
                </span>
                ) is not active in the current flow. It can be re-enabled later
                if Kie-native endings need to be replaced.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
