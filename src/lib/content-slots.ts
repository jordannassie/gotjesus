/**
 * Content slots — server-side only.
 *
 * Each workspace has up to N content slots, each with its own prompt, reference
 * images, scheduled post time, and generation settings. Currently "gotjesus"
 * has 3 slots: Morning, Midday, Evening.
 *
 * Designed as the future multi-workspace content scheduling layer.
 * Required SQL: see gotjesus_content_slots in /supabase/schema.sql
 */

import { createClient } from "@supabase/supabase-js";
import { CROSS_DISCOVERY_PROMPT } from "@/lib/cross-prompt";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SlotImage {
  url: string;
  path: string;
  name: string;
}

export interface ContentSlot {
  id: string;
  workspaceKey: string;
  slotKey: string;
  slotName: string;
  promptText: string;
  referenceImages: SlotImage[];
  enabled: boolean;
  scheduledPostTime: string;
  model: string;
  durationSeconds: number;
  aspectRatio: string;
  resolution: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface DbRow {
  id: string;
  created_at: string;
  updated_at: string;
  workspace_key: string;
  slot_key: string;
  slot_name: string;
  prompt_text: string;
  reference_images: SlotImage[];
  enabled: boolean;
  scheduled_post_time: string;
  model: string;
  duration_seconds: number;
  aspect_ratio: string;
  resolution: string;
  sort_order: number;
}

// ─── Default slot definitions ─────────────────────────────────────────────────

export const DEFAULT_SLOTS: Array<{
  slotKey: string;
  slotName: string;
  scheduledPostTime: string;
  sortOrder: number;
}> = [
  { slotKey: "slot_1", slotName: "Morning Reel", scheduledPostTime: "07:00", sortOrder: 1 },
  { slotKey: "slot_2", slotName: "Midday Reel", scheduledPostTime: "11:00", sortOrder: 2 },
  { slotKey: "slot_3", slotName: "Evening Reel", scheduledPostTime: "18:30", sortOrder: 3 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function requireClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured — SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing."
    );
  }
  return createClient(url, key);
}

function rowToSlot(row: DbRow): ContentSlot {
  return {
    id: row.id,
    workspaceKey: row.workspace_key,
    slotKey: row.slot_key,
    slotName: row.slot_name,
    promptText: row.prompt_text,
    referenceImages: Array.isArray(row.reference_images) ? row.reference_images : [],
    enabled: row.enabled,
    scheduledPostTime: row.scheduled_post_time,
    model: row.model,
    durationSeconds: row.duration_seconds,
    aspectRatio: row.aspect_ratio,
    resolution: row.resolution,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns all content slots for a workspace, sorted by sort_order.
 * Falls back to an empty array if Supabase is unavailable.
 */
export async function getContentSlots(workspaceKey = "gotjesus"): Promise<ContentSlot[]> {
  const supabase = getClient();
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
      .from("gotjesus_content_slots")
      .select("*")
      .eq("workspace_key", workspaceKey)
      .order("sort_order", { ascending: true });

    if (error) {
      console.warn("[content-slots] read error:", error.message);
      return [];
    }

    return (data as DbRow[]).map(rowToSlot);
  } catch (err) {
    console.warn("[content-slots] getContentSlots exception:", err);
    return [];
  }
}

/**
 * Returns a single slot by slot_key. Returns null if not found.
 */
export async function getContentSlotByKey(
  workspaceKey: string,
  slotKey: string
): Promise<ContentSlot | null> {
  const supabase = getClient();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from("gotjesus_content_slots")
      .select("*")
      .eq("workspace_key", workspaceKey)
      .eq("slot_key", slotKey)
      .maybeSingle();

    if (error || !data) return null;
    return rowToSlot(data as DbRow);
  } catch {
    return null;
  }
}

/**
 * Seeds all 3 default content slots for a workspace if none exist yet.
 * Safe to call on every page load — no-ops if rows already exist.
 */
export async function seedDefaultContentSlotsIfMissing(
  workspaceKey = "gotjesus"
): Promise<void> {
  const supabase = getClient();
  if (!supabase) return;

  try {
    const { count, error } = await supabase
      .from("gotjesus_content_slots")
      .select("id", { count: "exact", head: true })
      .eq("workspace_key", workspaceKey);

    if (error) {
      console.warn("[content-slots] seed count error:", error.message);
      return;
    }

    if ((count ?? 0) > 0) return; // already seeded

    const rows = DEFAULT_SLOTS.map((s) => ({
      workspace_key: workspaceKey,
      slot_key: s.slotKey,
      slot_name: s.slotName,
      prompt_text: CROSS_DISCOVERY_PROMPT,
      reference_images: [],
      enabled: true,
      scheduled_post_time: s.scheduledPostTime,
      model: "Seedance 2.0 Fast",
      duration_seconds: 8,
      aspect_ratio: "9:16",
      resolution: process.env.KIE_VIDEO_RESOLUTION || "480p",
      sort_order: s.sortOrder,
    }));

    const { error: insertErr } = await supabase
      .from("gotjesus_content_slots")
      .insert(rows);

    if (insertErr) {
      console.warn("[content-slots] seed insert error:", insertErr.message);
    } else {
      console.log("[content-slots] Seeded 3 default slots for", workspaceKey);
    }
  } catch (err) {
    console.warn("[content-slots] seedDefaultContentSlotsIfMissing exception:", err);
  }
}

/**
 * Creates or updates a content slot by id.
 * Throws a real Error if the database save fails.
 */
export async function upsertContentSlot(
  slot: Partial<ContentSlot> & { id: string }
): Promise<ContentSlot> {
  const supabase = requireClient();

  const updates: Partial<DbRow> = {
    updated_at: new Date().toISOString(),
  };

  if (slot.slotName !== undefined) updates.slot_name = slot.slotName;
  if (slot.promptText !== undefined) updates.prompt_text = slot.promptText;
  if (slot.enabled !== undefined) updates.enabled = slot.enabled;
  if (slot.scheduledPostTime !== undefined) updates.scheduled_post_time = slot.scheduledPostTime;
  if (slot.model !== undefined) updates.model = slot.model;
  if (slot.durationSeconds !== undefined) updates.duration_seconds = slot.durationSeconds;
  if (slot.aspectRatio !== undefined) updates.aspect_ratio = slot.aspectRatio;
  if (slot.resolution !== undefined) updates.resolution = slot.resolution;

  const { data, error } = await supabase
    .from("gotjesus_content_slots")
    .update(updates)
    .eq("id", slot.id)
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to update content slot: ${error?.message ?? "no data returned"}`
    );
  }

  console.log("[content-slots] Updated slot:", data.slot_key);
  return rowToSlot(data as DbRow);
}

/**
 * Replaces the reference_images array for a slot.
 * Throws on failure.
 */
export async function updateContentSlotImages(
  slotId: string,
  images: SlotImage[]
): Promise<ContentSlot> {
  const supabase = requireClient();

  const { data, error } = await supabase
    .from("gotjesus_content_slots")
    .update({
      reference_images: images,
      updated_at: new Date().toISOString(),
    })
    .eq("id", slotId)
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to update slot images: ${error?.message ?? "no data returned"}`
    );
  }

  return rowToSlot(data as DbRow);
}
