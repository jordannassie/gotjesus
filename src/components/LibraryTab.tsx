"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Reel } from "@/lib/reels-db";

type Filter = "all" | "liked" | "posted" | "not-posted";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

async function downloadVideo(url: string, reelId: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = `gotjesus-reel-${reelId}.mp4`;
    a.click();
    URL.revokeObjectURL(objUrl);
  } catch {
    window.open(url, "_blank");
  }
}

function isPosted(reel: Reel) {
  return !!(reel.instagram_post_submission_id || reel.tiktok_post_submission_id || reel.youtube_post_submission_id);
}

// ─── Video Card ───────────────────────────────────────────────────────────────

function ReelLibraryCard({
  reel,
  isActivePlay,
  onRequestPlay,
  onRequestStop,
  onFavoriteToggle,
  onDelete,
}: {
  reel: Reel;
  isActivePlay: boolean;
  onRequestPlay: (id: string) => void;
  onRequestStop: () => void;
  onFavoriteToggle: (id: string, current: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const manuallyPlaying = useRef(false);
  const [showControls, setShowControls] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const videoUrl = reel.saved_video_url ?? reel.kie_video_url;
  const posted = isPosted(reel);

  // Play or pause the video whenever isActivePlay changes.
  // Hover play → attempt with audio, fall back to muted if browser blocks.
  // Manual play → always unmute after successful play.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;

    if (isActivePlay) {
      const tryPlay = async () => {
        video.muted = false;
        try {
          await video.play();
        } catch {
          // Browser blocked unmuted autoplay — retry muted (common on mobile/hover)
          video.muted = true;
          await video.play().catch(() => {});
        }
        // If user manually clicked, unmute after the browser lets us play
        if (manuallyPlaying.current) {
          video.muted = false;
        }
      };
      void tryPlay();
    } else {
      video.pause();
      // Reset position only if not in manual mode (hover preview resets; manual keeps position)
      if (!manuallyPlaying.current) {
        video.currentTime = 0;
        video.muted = false;
      }
    }
  }, [isActivePlay, videoUrl]);

  const handleMouseEnter = useCallback(() => {
    if (!videoUrl) return;
    onRequestPlay(reel.id);
  }, [videoUrl, reel.id, onRequestPlay]);

  const handleMouseLeave = useCallback(() => {
    // Only stop if the user has not manually pressed play
    if (!manuallyPlaying.current) {
      onRequestStop();
    }
  }, [onRequestStop]);

  const handleClickToggle = useCallback(() => {
    if (!videoUrl) return;
    if (isActivePlay && manuallyPlaying.current) {
      // Manual stop
      manuallyPlaying.current = false;
      setShowControls(false);
      onRequestStop();
    } else {
      // Manual play — set flag first so the effect can unmute
      manuallyPlaying.current = true;
      setShowControls(true);
      onRequestPlay(reel.id);
    }
  }, [videoUrl, isActivePlay, reel.id, onRequestPlay, onRequestStop]);

  // When another card takes over (isActivePlay → false) reset manual flag
  useEffect(() => {
    if (!isActivePlay) {
      manuallyPlaying.current = false;
      setShowControls(false);
    }
  }, [isActivePlay]);

  const isPlaying = isActivePlay;

  return (
    <div className="flex flex-col gap-0 bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
      {/* Video / thumbnail */}
      <div
        className="relative bg-black cursor-pointer"
        style={{ aspectRatio: "9 / 16" }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClickToggle}
      >
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            playsInline
            loop
            controls={showControls}
            preload="metadata"
            className="absolute inset-0 w-full h-full object-contain"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs text-neutral-600">No video</span>
          </div>
        )}
        {/* Play overlay — hidden while playing */}
        {!isPlaying && videoUrl && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity">
            <svg className="w-8 h-8 text-white/70" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
            </svg>
          </div>
        )}
        {/* Status badge */}
        <div className="absolute top-2 left-2">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${
            reel.status === "ready" || reel.status === "posted" || reel.status === "scheduled"
              ? "bg-emerald-900/80 text-emerald-300"
              : reel.status === "failed"
              ? "bg-red-900/80 text-red-300"
              : "bg-neutral-800/80 text-neutral-400"
          }`}>
            {reel.status}
          </span>
        </div>
      </div>

      {/* Info */}
      <div className="px-3 py-2.5 flex flex-col gap-1.5">
        <div className="flex flex-col gap-0.5">
          {reel.content_slot_name && (
            <span className="text-[11px] font-semibold text-neutral-300">
              {reel.content_slot_name}
            </span>
          )}
          <span className="text-[10px] text-neutral-600">{formatDate(reel.created_at)}</span>
          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
              reel.generation_source === "scheduled"
                ? "border-violet-800 text-violet-400"
                : "border-neutral-800 text-neutral-500"
            }`}>
              {reel.generation_source === "scheduled" ? "Scheduled" : "Manual"}
            </span>
            {posted && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-800 text-emerald-400">
                Posted
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1.5">
            {/* Download */}
            {videoUrl && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void downloadVideo(videoUrl, reel.id); }}
                title="Download"
                className="w-7 h-7 flex items-center justify-center rounded-lg border border-neutral-800 text-neutral-500 hover:text-neutral-300 hover:border-neutral-700 transition-colors"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            )}
            {/* Favorite */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onFavoriteToggle(reel.id, reel.is_favorite); }}
              title={reel.is_favorite ? "Unfavorite" : "Favorite"}
              className={`w-7 h-7 flex items-center justify-center rounded-lg border transition-colors ${
                reel.is_favorite
                  ? "border-amber-700 text-amber-400"
                  : "border-neutral-800 text-neutral-600 hover:text-amber-400 hover:border-amber-800"
              }`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill={reel.is_favorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth={reel.is_favorite ? 0 : 1.5}>
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            </button>
          </div>

          {/* Delete */}
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete(reel.id); setConfirmDelete(false); }}
                className="text-[10px] px-2 py-1 rounded bg-red-900 text-red-300 hover:bg-red-800 transition-colors"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
                className="text-[10px] px-2 py-1 rounded border border-neutral-800 text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
              title="Delete"
              className="w-7 h-7 flex items-center justify-center rounded-lg border border-neutral-800 text-neutral-600 hover:text-red-400 hover:border-red-900 transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Library Tab ──────────────────────────────────────────────────────────────

export default function LibraryTab() {
  const [reels, setReels] = useState<Reel[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  // Track which card is currently playing — only one at a time
  const [playingId, setPlayingId] = useState<string | null>(null);

  const fetchReels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/reels");
      if (res.ok) setReels((await res.json()) as Reel[]);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchReels(); }, [fetchReels]);

  const handleFavoriteToggle = useCallback(async (id: string, current: boolean) => {
    const newVal = !current;
    setReels((prev) => prev.map((r) => r.id === id ? { ...r, is_favorite: newVal } : r));
    try {
      await fetch("/api/reels", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reelId: id, isFavorite: newVal }),
      });
    } catch {
      setReels((prev) => prev.map((r) => r.id === id ? { ...r, is_favorite: current } : r));
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    setReels((prev) => prev.filter((r) => r.id !== id));
    if (playingId === id) setPlayingId(null);
    try {
      await fetch(`/api/reels?reelId=${id}`, { method: "DELETE" });
    } catch { void fetchReels(); }
  }, [fetchReels, playingId]);

  const filtered = reels.filter((r) => {
    if (filter === "liked") return r.is_favorite;
    if (filter === "posted") return isPosted(r);
    if (filter === "not-posted") return !isPosted(r);
    return true;
  });

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "liked", label: "Liked" },
    { key: "posted", label: "Posted" },
    { key: "not-posted", label: "Not Posted" },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Filter bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-1.5">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === key
                  ? "bg-white text-black"
                  : "border border-neutral-800 text-neutral-500 hover:text-neutral-300 hover:border-neutral-700"
              }`}
            >
              {label}
              {key === "all" && reels.length > 0 && (
                <span className={`ml-1.5 text-[10px] ${filter === key ? "text-neutral-600" : "text-neutral-700"}`}>
                  {reels.length}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={fetchReels}
          disabled={loading}
          className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors disabled:opacity-40"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* Grid */}
      {loading && reels.length === 0 ? (
        <div className="py-16 text-center">
          <span className="text-xs text-neutral-600">Loading library…</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-neutral-500">
            {filter === "all" ? "No videos yet. Generate a test reel to see it here." : `No ${filter} videos.`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {filtered.map((reel) => (
            <ReelLibraryCard
              key={reel.id}
              reel={reel}
              isActivePlay={playingId === reel.id}
              onRequestPlay={setPlayingId}
              onRequestStop={() => setPlayingId(null)}
              onFavoriteToggle={handleFavoriteToggle}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
