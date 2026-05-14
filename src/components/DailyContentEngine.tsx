"use client";

import { useState } from "react";
import ContentSlotCard from "@/components/ContentSlotCard";
import type { ContentSlot } from "@/lib/content-slots";

interface Props {
  initialSlots: ContentSlot[];
}

export default function DailyContentEngine({ initialSlots }: Props) {
  const [slots, setSlots] = useState<ContentSlot[]>(initialSlots);

  function handleSlotUpdate(updated: ContentSlot) {
    setSlots((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }

  if (slots.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-neutral-500">No content slots found.</p>
        <p className="text-xs text-neutral-700 mt-1">
          Run the SQL in supabase/schema.sql to create the gotjesus_content_slots table, then refresh.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-neutral-500">
        Each slot runs daily at its scheduled Pacific Time. Edit prompts, attach reference images, and toggle slots on or off. Save each slot after making changes.
      </p>
      {slots.map((slot) => (
        <ContentSlotCard key={slot.id} slot={slot} onSlotUpdate={handleSlotUpdate} />
      ))}
    </div>
  );
}
