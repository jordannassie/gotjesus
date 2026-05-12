"use client";

import { useState, useRef, useCallback } from "react";

type GenerationState =
  | "idle"
  | "submitting"
  | "waiting"
  | "queuing"
  | "generating"
  | "success"
  | "failed";

const STATE_LABELS: Record<GenerationState, string> = {
  idle: "",
  submitting: "Submitting to Seedance...",
  waiting: "Generating video...",
  queuing: "Generating video...",
  generating: "Generating video...",
  success: "Video ready",
  failed: "Generation failed",
};

const POLL_INTERVAL_MS = 6000;
const MAX_POLL_ATTEMPTS = 120; // 12 minutes max

export default function VideoEngine() {
  const [genState, setGenState] = useState<GenerationState>("idle");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollCount = useRef(0);

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

        // Still in progress (waiting / queuing / generating)
        const inProgressState = rawState as GenerationState;
        setGenState(inProgressState);
        pollTimer.current = setTimeout(() => poll(id), POLL_INTERVAL_MS);
      } catch (err) {
        stopPolling();
        setGenState("failed");
        setErrorMsg(err instanceof Error ? err.message : "Polling error.");
      }
    },
    [stopPolling]
  );

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

  return (
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
      <div className="flex flex-col gap-3">
        {[
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
            status: "Not Connected Yet",
            active: false,
          },
        ].map(({ label, status, active }) => (
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
        className="mt-2 w-full py-3 px-6 rounded-lg bg-white text-black text-sm font-semibold tracking-wide hover:bg-neutral-200 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isRunning ? STATE_LABELS[genState] : "Generate Test Video"}
      </button>

      {/* Spinner + status label while running */}
      {isRunning && (
        <div className="flex items-center gap-3">
          <span className="inline-block w-4 h-4 border-2 border-neutral-600 border-t-white rounded-full animate-spin" />
          <span className="text-sm text-neutral-400">
            {STATE_LABELS[genState]}
          </span>
        </div>
      )}

      {/* Error state */}
      {genState === "failed" && errorMsg && (
        <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3">
          <p className="text-xs text-red-400 leading-relaxed">
            <span className="font-semibold text-red-300">Error: </span>
            {errorMsg}
          </p>
        </div>
      )}

      {/* Success — video player */}
      {genState === "success" && videoUrl && (
        <div className="flex flex-col items-center gap-4">
          <div className="w-full rounded-xl overflow-hidden border border-neutral-700">
            {/* 9:16 aspect ratio container */}
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
          <div className="flex items-center gap-2 w-full">
            <span className="text-xs font-medium text-emerald-500 shrink-0">
              Video ready
            </span>
            <span className="text-xs text-neutral-600 truncate">{videoUrl}</span>
          </div>
        </div>
      )}

      {/* Debug task ID */}
      {taskId && (
        <p className="text-xs text-neutral-700 font-mono">
          task: {taskId}
        </p>
      )}
    </div>
  );
}
