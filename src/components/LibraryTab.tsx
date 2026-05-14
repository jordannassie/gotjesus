"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Reel } from "@/lib/reels-db";

type PostNowStatus = "idle" | "posting" | "done" | "error";

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

// Derive a clear posting status label + color from the reel record
function postingStatus(reel: Reel): { label: string; color: string } {
  if (reel.status === "failed")
    return { label: "Post Failed", color: "border-red-900 text-red-400" };
  if (reel.posting_source === "auto")
    return { label: "Auto Posted", color: "border-emerald-900 text-emerald-400" };
  if (reel.posting_source === "manual")
    return { label: "Posted", color: "border-emerald-900 text-emerald-400" };
  // Legacy reels posted before posting_source was added
  if (isPosted(reel))
    return { label: "Posted", color: "border-emerald-900 text-emerald-400" };
  return { label: "Not Posted", color: "border-neutral-800 text-neutral-600" };
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
  const [videoReady, setVideoReady] = useState(false);
  const [postNowStatus, setPostNowStatus] = useState<PostNowStatus>("idle");
  const [postNowLabel, setPostNowLabel] = useState("");
  const postNowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoUrl = reel.saved_video_url ?? reel.kie_video_url;
  const posted = isPosted(reel);

  const handlePostNow = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (postNowStatus === "posting") return;
    setPostNowStatus("posting");
    setPostNowLabel("");
    if (postNowTimer.current) clearTimeout(postNowTimer.current);
    try {
      const res = await fetch("/api/post-reel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reelId: reel.id }),
      });
      const data = (await res.json()) as {
        posted?: string[];
        error?: string;
        errors?: Record<string, string>;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const platforms = data.posted ?? [];
      setPostNowLabel(platforms.length > 0 ? `Posted to ${platforms.join(", ")} ✓` : "No platforms posted");
      setPostNowStatus("done");
    } catch (err) {
      setPostNowLabel(err instanceof Error ? err.message : "Post failed");
      setPostNowStatus("error");
    } finally {
      postNowTimer.current = setTimeout(() => {
        setPostNowStatus("idle");
        setPostNowLabel("");
      }, 5000);
    }
  }, [reel.id, postNowStatus]);

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
  const pStatus = postingStatus(reel);
  const caption = reel.caption_used?.trim() || "";
  const [captionExpanded, setCaptionExpanded] = useState(false);

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
            onLoadedData={() => setVideoReady(true)}
            className="absolute inset-0 w-full h-full object-contain"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs text-neutral-600">No video</span>
          </div>
        )}
        {/* Neon preloader — shown until video metadata is ready */}
        {videoUrl && !videoReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <div className="relative w-10 h-10">
              <div
                className="absolute inset-0 rounded-full animate-spin"
                style={{
                  border: "2px solid transparent",
                  borderTopColor: "#a3e635",
                  borderRightColor: "#22d3ee",
                  filter: "drop-shadow(0 0 4px #22d3ee) drop-shadow(0 0 8px #a3e635)",
                  animationDuration: "0.9s",
                }}
              />
              <div
                className="absolute inset-1.5 rounded-full animate-spin"
                style={{
                  border: "2px solid transparent",
                  borderBottomColor: "#a855f7",
                  borderLeftColor: "#22d3ee",
                  filter: "drop-shadow(0 0 4px #a855f7)",
                  animationDuration: "0.6s",
                  animationDirection: "reverse",
                }}
              />
            </div>
          </div>
        )}
        {/* Play overlay */}
        {!isPlaying && videoUrl && videoReady && (
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
      <div className="px-3 py-2.5 flex flex-col gap-2">
        {/* Title + date */}
        <div className="flex flex-col gap-0.5">
          {reel.content_slot_name && (
            <span className="text-[11px] font-semibold text-neutral-200 leading-tight">
              {reel.content_slot_name}
            </span>
          )}
          <span className="text-[10px] text-neutral-600">{formatDate(reel.created_at)}</span>
        </div>

        {/* Status pills row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Generation source */}
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
            reel.generation_source === "scheduled"
              ? "border-violet-900 text-violet-400"
              : "border-neutral-800 text-neutral-600"
          }`}>
            {reel.generation_source === "scheduled" ? "Auto Gen" : "Manual Gen"}
          </span>
          {/* Posting status */}
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${pStatus.color}`}>
            {pStatus.label}
          </span>
        </div>

        {/* Caption preview */}
        <div
          className="cursor-pointer"
          onClick={(e) => { e.stopPropagation(); setCaptionExpanded((v) => !v); }}
          title={captionExpanded ? "Collapse" : "Expand caption"}
        >
          {caption ? (
            <p className={`text-[10px] text-neutral-500 leading-relaxed ${
              captionExpanded ? "" : "line-clamp-2"
            }`}>
              {caption}
            </p>
          ) : (
            <p className="text-[10px] text-neutral-700 italic">No caption saved</p>
          )}
        </div>

        {/* Actions row: Post Now pill + icon buttons */}
        <div className="flex items-center gap-1.5 pt-0.5">
          {/* Post Now — compact labeled pill */}
          {videoUrl && (
            <button
              type="button"
              onClick={handlePostNow}
              disabled={postNowStatus === "posting"}
              title={postNowLabel || "Post to all enabled social platforms now"}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold border transition-colors flex-shrink-0 ${
                postNowStatus === "done"
                  ? "border-emerald-800 text-emerald-400 bg-emerald-900/30"
                  : postNowStatus === "error"
                  ? "border-red-800 text-red-400 bg-red-900/30"
                  : postNowStatus === "posting"
                  ? "border-neutral-700 text-neutral-500 cursor-wait"
                  : "border-neutral-700 text-neutral-400 hover:border-blue-800 hover:text-blue-400 hover:bg-blue-900/20"
              }`}
            >
              {postNowStatus === "posting" ? (
                <svg className="w-2.5 h-2.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : postNowStatus === "done" ? (
                <svg className="w-2.5 h-2.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              ) : postNowStatus === "error" ? (
                <svg className="w-2.5 h-2.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-2.5 h-2.5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                </svg>
              )}
              {postNowStatus === "posting" ? "Posting…"
                : postNowStatus === "done" ? "Posted ✓"
                : postNowStatus === "error" ? "Failed"
                : "Post Now"}
            </button>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Download */}
          {videoUrl && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); void downloadVideo(videoUrl, reel.id); }}
              title="Download"
              className="w-6 h-6 flex items-center justify-center rounded-lg border border-neutral-800 text-neutral-600 hover:text-neutral-300 hover:border-neutral-700 transition-colors"
            >
              <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          )}

          {/* Favorite */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onFavoriteToggle(reel.id, reel.is_favorite); }}
            title={reel.is_favorite ? "Unfavorite" : "Favorite"}
            className={`w-6 h-6 flex items-center justify-center rounded-lg border transition-colors ${
              reel.is_favorite
                ? "border-amber-700 text-amber-400"
                : "border-neutral-800 text-neutral-600 hover:text-amber-400 hover:border-amber-800"
            }`}
          >
            <svg className="w-3 h-3" viewBox="0 0 20 20" fill={reel.is_favorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth={reel.is_favorite ? 0 : 1.5}>
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
          </button>

          {/* Delete */}
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete(reel.id); setConfirmDelete(false); }}
                className="text-[10px] px-1.5 py-0.5 rounded bg-red-900 text-red-300 hover:bg-red-800 transition-colors"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
                className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-800 text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
              title="Delete"
              className="w-6 h-6 flex items-center justify-center rounded-lg border border-neutral-800 text-neutral-600 hover:text-red-400 hover:border-red-900 transition-colors"
            >
              <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>

        {/* Inline error/success detail below actions */}
        {postNowLabel && (postNowStatus === "done" || postNowStatus === "error") && (
          <p className={`text-[9px] leading-tight ${
            postNowStatus === "error" ? "text-red-500" : "text-emerald-500"
          }`}>
            {postNowLabel}
          </p>
        )}
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
          className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-300 transition-colors disabled:opacity-50"
        >
          {loading ? (
            <>
              <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading…
            </>
          ) : "Refresh"}
        </button>
      </div>

      {/* Grid */}
      {loading && reels.length === 0 ? (
        <div className="py-20 flex flex-col items-center justify-center gap-3">
          <div className="relative w-10 h-10">
            <div
              className="absolute inset-0 rounded-full animate-spin"
              style={{
                border: "2.5px solid transparent",
                borderTopColor: "#a3e635",
                borderRightColor: "#22d3ee",
                filter: "drop-shadow(0 0 6px #22d3ee) drop-shadow(0 0 10px #a3e635)",
                animationDuration: "0.9s",
              }}
            />
            <div
              className="absolute inset-2 rounded-full animate-spin"
              style={{
                border: "2px solid transparent",
                borderBottomColor: "#a855f7",
                borderLeftColor: "#22d3ee",
                filter: "drop-shadow(0 0 5px #a855f7)",
                animationDuration: "0.6s",
                animationDirection: "reverse",
              }}
            />
          </div>
          <span className="text-xs tracking-wide" style={{ color: "#22d3ee99" }}>Loading library…</span>
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
