/**
 * Database helpers for the gotjesus_reels table — server-side only.
 *
 * Each row represents one generated reel, from initial Kie job submission
 * through to Blotato publishing. Statuses progress as:
 *
 *   generating → saving → ready → posting → posted
 *                                  └→ scheduled (for scheduled future posts)
 *   Any stage can transition to: failed
 */

import { createClient } from "@supabase/supabase-js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReelStatus =
  | "generating"
  | "saving"
  | "ready"
  | "posting"
  | "scheduled"
  | "posted"
  | "failed";

export interface Reel {
  id: string;
  created_at: string;
  generation_source: "manual" | "scheduled";
  scheduled_for: string | null;
  kie_task_id: string | null;
  kie_video_url: string | null;
  saved_video_url: string | null;
  prompt_used: string | null;
  caption_used: string;
  status: ReelStatus;
  blotato_status: string | null;
  instagram_enabled: boolean;
  tiktok_enabled: boolean;
  youtube_enabled: boolean;
  instagram_post_submission_id: string | null;
  tiktok_post_submission_id: string | null;
  youtube_post_submission_id: string | null;
  error_message: string | null;
}

export type CreateReelInput = Partial<Reel> & {
  status: ReelStatus;
  caption_used: string;
};

// ─── Client ───────────────────────────────────────────────────────────────────

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error(
      "Supabase is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  return createClient(url, key);
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function createReel(data: CreateReelInput): Promise<Reel> {
  const supabase = getClient();
  const { data: row, error } = await supabase
    .from("gotjesus_reels")
    .insert(data)
    .select()
    .single();
  if (error || !row)
    throw new Error(
      `createReel failed: ${error?.message ?? "no row returned"}`
    );
  return row as Reel;
}

export async function updateReel(
  id: string,
  data: Partial<Reel>
): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase
    .from("gotjesus_reels")
    .update(data)
    .eq("id", id);
  if (error) throw new Error(`updateReel(${id}) failed: ${error.message}`);
}

export async function getReel(id: string): Promise<Reel | null> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("gotjesus_reels")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.warn(`[reels-db] getReel(${id}):`, error.message);
    return null;
  }
  return (data as Reel) ?? null;
}

export async function getRecentReels(limit = 20): Promise<Reel[]> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("gotjesus_reels")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn("[reels-db] getRecentReels:", error.message);
    return [];
  }
  return (data ?? []) as Reel[];
}

export async function deleteReelRow(id: string): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase
    .from("gotjesus_reels")
    .delete()
    .eq("id", id);
  if (error) throw new Error(`deleteReelRow(${id}) failed: ${error.message}`);
}

/**
 * Check if a scheduled reel already exists for a specific UTC time slot
 * (within ±5 minutes). Used by the daily scheduler to prevent duplicates.
 */
export async function scheduledReelExists(
  scheduledForISO: string
): Promise<boolean> {
  const supabase = getClient();
  const target = new Date(scheduledForISO);
  const from = new Date(target.getTime() - 5 * 60 * 1000).toISOString();
  const to = new Date(target.getTime() + 5 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("gotjesus_reels")
    .select("id")
    .eq("generation_source", "scheduled")
    .gte("scheduled_for", from)
    .lte("scheduled_for", to)
    .maybeSingle();

  if (error) return false;
  return data !== null;
}
