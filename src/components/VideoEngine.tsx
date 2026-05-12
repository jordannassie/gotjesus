"use client";

import { useState, useRef, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type GenerationState =
  | "idle"
  | "submitting"
  | "waiting"
  | "queuing"
  | "generating"
  | "success"
  | "failed";

interface VideoEngineProps {
  blotatoConnected: boolean;
  promptSummary: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATE_LABELS: Record<GenerationState, string> = {
  idle: "Generate Video",
  submitting: "Submitting to Seedance...",
  waiting: "Generating video...",
  queuing: "Generating video...",
  generating: "Generating video...",
  success: "Generate Video",
  failed: "Generate Video",
};

const POLL_INTERVAL_MS = 6000;
const MAX_POLL_ATTEMPTS = 120; // 12 minutes max

// ─── Toggle component ─────────────────────────────────────────────────────────

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

// ─── Main component ───────────────────────────────────────────────────────────

export default function VideoEngine({
  blotatoConnected,
  promptSummary,
}: VideoEngineProps) {
  // Generation state
  const [genState, setGenState] = useState<GenerationState>("idle");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Post toggles — auto-post OFF by default; platforms ON by default
  const [autoPost, setAutoPost] = useState(false);
  const [postInstagram, setPostInstagram] = useState(true);
  const [postTiktok, setPostTiktok] = useState(true);
  const [postYoutube, setPostYoutube] = useState(true);

  // Advanced section
  const [showAdvanced, setShowAdvanced] = useState(false);

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollCount = useRef(0);

  // ─── Polling ──────────────────────────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const poll = useCallback(
    async (id: string) => {
      if (pollCount.current >= MAX_POLL_ATTEMPTS) {
        stopPolling();
        setGenState("failed");
        setErrorMsg("Generation timed out after 12 minutes.");
        return;
      }

      pollCount.current += 1;

      try {
        const res = await fetch(`/api/generate-video?taskId=${id}`);
        const data = (await res.json()) as {
          state?: string;
          videoUrl?: string | null;
          failMsg?: string | null;
          error?: string;
        };

        if (!res.ok || data.error) {
          stopPolling();
          setGenState("failed");
          setErrorMsg(data.error ?? "Unknown error from server.");
          return;
        }

        const rawState = data.state as string;

        if (rawState === "success") {
          stopPolling();
          setGenState("success");
          setVideoUrl(data.videoUrl ?? null);
          return;
        }

        if (rawState === "fail") {
          stopPolling();
          setGenState("failed");
          setErrorMsg(data.failMsg ?? "Kie.ai reported generation failure.");
          return;
        }

        setGenState(rawState as GenerationState);
        pollTimer.current = setTimeout(() => poll(id), POLL_INTERVAL_MS);
      } catch (err) {
        stopPolling();
        setGenState("failed");
        setErrorMsg(err instanceof Error ? err.message : "Polling error.");
      }
    },
    [stopPolling]
  );

  // ─── Generate ─────────────────────────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    stopPolling();
    setGenState("submitting");
    setTaskId(null);
    setVideoUrl(null);
    setErrorMsg(null);
    pollCount.current = 0;

    try {
      const res = await fetch("/api/generate-video", { method: "POST" });
      const data = (await res.json()) as { taskId?: string; error?: string };

      if (!res.ok || data.error) {
        setGenState("failed");
        setErrorMsg(data.error ?? "Failed to submit generation task.");
        return;
      }

      const id = data.taskId!;
      setTaskId(id);
      setGenState("waiting");
      pollTimer.current = setTimeout(() => poll(id), POLL_INTERVAL_MS);
    } catch (err) {
      setGenState("failed");
      setErrorMsg(err instanceof Error ? err.message : "Submit error.");
    }
  }, [poll, stopPolling]);

  const isRunning = ["submitting", "waiting", "queuing", "generating"].includes(
    genState
  );

  // ─── Derived display values ────────────────────────────────────────────────

  const statusRows = [
    {
      label: "Kie.ai Seedance 2.0",
      status: "Connected",
      active: true,
    },
    {
      label: "Got Jesus? Logo End Card",
      status: "Asset Ready",
      active: true,
    },
    {
      label: "Blotato Social Posting",
      status: blotatoConnected ? "Connected" : "Not Connected Yet",
      active: blotatoConnected,
    },
  ];

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="w-full flex flex-col gap-6">
      {/* ── Engine card ── */}
      <div className="w-full border border-neutral-800 rounded-2xl p-8 flex flex-col gap-6 bg-neutral-950">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-wide text-white">
            Cross Discovery Video Engine
          </h2>
          <p className="text-xs text-neutral-500">
            Kie.ai Seedance 2.0 Fast — 9:16 vertical — 720p — 8 seconds
          </p>
        </div>

        {/* Status rows */}
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

        {/* Generate button */}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isRunning}
          className="w-full py-3 px-6 rounded-lg bg-white text-black text-sm font-semibold tracking-wide hover:bg-neutral-200 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isRunning ? STATE_LABELS[genState] : "Generate Video"}
        </button>

        {/* Spinner + in-progress label */}
        {isRunning && (
          <div className="flex items-center gap-3">
            <span className="inline-block w-4 h-4 border-2 border-neutral-600 border-t-white rounded-full animate-spin shrink-0" />
            <span className="text-sm text-neutral-400">
              {STATE_LABELS[genState]}
            </span>
          </div>
        )}

        {/* Error */}
        {genState === "failed" && errorMsg && (
          <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3">
            <p className="text-xs text-red-400 leading-relaxed">
              <span className="font-semibold text-red-300">Error: </span>
              {errorMsg}
            </p>
          </div>
        )}

        {/* Debug task ID */}
        {taskId && (
          <p className="text-xs text-neutral-700 font-mono">task: {taskId}</p>
        )}
      </div>

      {/* ── Video preview card (shown once ready) ── */}
      {genState === "success" && videoUrl && (
        <div className="w-full border border-neutral-800 rounded-2xl p-8 flex flex-col gap-5 bg-neutral-950">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-wide text-white">
              Video Preview
            </h2>
            <span className="text-xs font-medium text-emerald-500">
              Video ready
            </span>
          </div>

          {/* 9:16 player */}
          <div className="w-full rounded-xl overflow-hidden border border-neutral-700">
            <div className="relative w-full" style={{ aspectRatio: "9 / 16" }}>
              <video
                src={videoUrl}
                controls
                autoPlay
                loop
                playsInline
                className="absolute inset-0 w-full h-full object-contain bg-black"
              />
            </div>
          </div>

          {/* End card note */}
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3">
            <p className="text-xs text-neutral-400 leading-relaxed">
              <span className="text-neutral-300 font-medium">Next step: </span>
              Official Got Jesus end card will be appended to this video in the
              next pipeline step.
            </p>
          </div>

          {/* Debug URL */}
          <p className="text-xs text-neutral-700 font-mono break-all">
            {videoUrl}
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

        {/* Auto Post master toggle */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between py-3 px-4 rounded-lg border border-neutral-800 bg-neutral-900">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-white">Auto Post</span>
              <span className="text-xs text-neutral-500">
                Post automatically when video is ready
              </span>
            </div>
            <Toggle
              checked={autoPost}
              onChange={() => setAutoPost((v) => !v)}
              disabled={!blotatoConnected}
            />
          </div>

          {/* Platform toggles */}
          {(
            [
              { key: "instagram", label: "Instagram", checked: postInstagram, set: setPostInstagram },
              { key: "tiktok", label: "TikTok", checked: postTiktok, set: setPostTiktok },
              { key: "youtube", label: "YouTube", checked: postYoutube, set: setPostYoutube },
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
                onChange={() => set((v) => !v)}
                disabled={!blotatoConnected}
              />
            </div>
          ))}
        </div>

        {!blotatoConnected && (
          <p className="text-xs text-neutral-600">
            Set BLOTATO_API_KEY and at least one platform account ID in your
            environment variables to enable posting.
          </p>
        )}

        {autoPost && blotatoConnected && (
          <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-4 py-3">
            <p className="text-xs text-amber-400/80 leading-relaxed">
              Auto Post is ON. Once a final video (with end card) is ready, it
              will be posted to the selected platforms automatically.
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
          <div className="px-8 pb-6 flex flex-col gap-3 border-t border-neutral-800">
            <p className="text-xs text-neutral-500 pt-4">Prompt summary</p>
            <p className="text-xs text-neutral-400 leading-relaxed">
              {promptSummary}
            </p>
            <p className="text-xs text-neutral-600">
              Full prompt is stored server-side only in{" "}
              <span className="font-mono">src/lib/cross-prompt.ts</span>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
