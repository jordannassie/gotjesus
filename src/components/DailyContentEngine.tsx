"use client";

import { useState, useCallback } from "react";
import ContentSlotCard from "@/components/ContentSlotCard";
import type { ContentSlot } from "@/lib/content-slots";

interface Props {
  initialSlots: ContentSlot[];
}

export default function DailyContentEngine({ initialSlots }: Props) {
  const [slots, setSlots] = useState<ContentSlot[]>(initialSlots);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  // ── Update a slot in local state after a save ────────────────────────────
  function handleSlotUpdate(updated: ContentSlot) {
    setSlots((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }

  // ── Add a brand-new empty slot ───────────────────────────────────────────
  const handleAddSlot = useCallback(async () => {
    setAdding(true);
    setAddError("");
    try {
      const res = await fetch("/api/content-slots", { method: "POST" });
      const data = (await res.json()) as ContentSlot & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSlots((prev) => [...prev, data]);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add section.");
    } finally {
      setAdding(false);
    }
  }, []);

  // ── Duplicate a slot ─────────────────────────────────────────────────────
  const handleDuplicateSlot = useCallback(async (source: ContentSlot) => {
    setAdding(true);
    setAddError("");
    try {
      const res = await fetch("/api/content-slots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slotName: `${source.slotName} — Copy`,
          promptText: source.promptText,
          // reference images are not deep-copied to avoid duplicate storage paths
          referenceImages: [],
          enabled: false,
          scheduledPostTime: source.scheduledPostTime,
          durationSeconds: source.durationSeconds,
          aspectRatio: source.aspectRatio,
          resolution: source.resolution,
          model: source.model,
        }),
      });
      const data = (await res.json()) as ContentSlot & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSlots((prev) => [...prev, data]);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to duplicate section.");
    } finally {
      setAdding(false);
    }
  }, []);

  // ── Delete a slot ─────────────────────────────────────────────────────────
  const handleDeleteSlot = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/content-slots?id=${id}`, { method: "DELETE" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSlots((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      console.error("[engine] delete slot failed:", err);
    }
  }, []);

  if (slots.length === 0) {
    return (
      <div className="py-12 text-center flex flex-col items-center gap-4">
        <p className="text-sm text-neutral-500">No content sections yet.</p>
        <button
          type="button"
          onClick={handleAddSlot}
          disabled={adding}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-dashed border-neutral-700 text-sm text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors disabled:opacity-50"
        >
          <span className="text-lg leading-none">+</span>
          Add Content Section
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-neutral-500">
        Each section runs daily at its scheduled Pacific Time. Edit prompts, attach reference images, and toggle sections on or off. Save each section after making changes.
      </p>

      {slots.map((slot) => (
        <ContentSlotCard
          key={slot.id}
          slot={slot}
          onSlotUpdate={handleSlotUpdate}
          onDelete={handleDeleteSlot}
          onDuplicate={handleDuplicateSlot}
          isLastSlot={slots.length === 1}
        />
      ))}

      {/* Add Section button */}
      <button
        type="button"
        onClick={handleAddSlot}
        disabled={adding}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border border-dashed border-neutral-800 text-sm text-neutral-500 hover:text-neutral-300 hover:border-neutral-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {adding ? (
          <><span className="w-3.5 h-3.5 border border-neutral-600 border-t-neutral-300 rounded-full animate-spin inline-block" /> Creating…</>
        ) : (
          <><span className="text-lg leading-none font-light">+</span> Add Content Section</>
        )}
      </button>

      {addError && (
        <p className="text-xs text-red-400 text-center">{addError}</p>
      )}
    </div>
  );
}
