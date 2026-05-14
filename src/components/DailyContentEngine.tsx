"use client";

import { useState } from "react";
import ContentSlotCard from "@/components/ContentSlotCard";
import type { ContentSlot } from "@/lib/content-slots";

interface Props {
  initialSlots: ContentSlot[];
}

export default function DailyContentEngine({ initialSlots }: Props) {
  const [slots, setSlots] = useState<ContentSlot[]>(initialSlots);
  const [open, setOpen] = useState(false);

  function handleSlotUpdate(updated: ContentSlot) {
    setSlots((prev) =>
      prev.map((s) => (s.id === updated.id ? updated : s))
    );
  }

  const enabledCount = slots.filter((s) => s.enabled).length;

  return (
    <div className="w-full border border-neutral-800 rounded-2xl bg-neutral-950">
      {/* Section header — collapsible */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 text-left px-8 py-5 group"
      >
        <div className="flex flex-col gap-0.5">
          <span className="text-lg font-semibold tracking-wide text-white group-hover:text-neutral-200 transition-colors">
            Daily Content Engine
          </span>
          {!open && (
            <span className="text-xs text-neutral-500">
              {slots.length} slots
              {enabledCount > 0
                ? ` · ${enabledCount} enabled`
                : " · all disabled"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {enabledCount > 0 && (
            <span className="text-xs text-emerald-400 font-medium">
              {enabledCount} Active
            </span>
          )}
          <svg
            className={`w-4 h-4 text-neutral-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      </button>

      {open && (
        <div className="px-6 pb-8 flex flex-col gap-5 border-t border-neutral-800 pt-6">
          <p className="text-xs text-neutral-500">
            Each slot runs daily at its scheduled Pacific Time. Edit prompts,
            attach reference images, and toggle slots on or off. Save each slot
            after making changes.
          </p>

          {slots.length === 0 ? (
            <p className="text-xs text-neutral-600">
              No content slots found. Run the SQL in supabase/schema.sql to create
              the gotjesus_content_slots table, then refresh.
            </p>
          ) : (
            slots.map((slot) => (
              <ContentSlotCard
                key={slot.id}
                slot={slot}
                onSlotUpdate={handleSlotUpdate}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
