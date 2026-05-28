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
  // Per-platform posting detail (status, public URL, error)
  instagram_post_status: string | null;
  tiktok_post_status: string | null;
  youtube_post_status: string | null;
  instagram_post_url: string | null;
  tiktok_post_url: string | null;
  youtube_post_url: string | null;
  instagram_error: string | null;
  tiktok_error: string | null;
  youtube_error: string | null;
  error_message: string | null;
  // Library features
  is_favorite: boolean;
  content_slot_key: string | null;
  content_slot_name: string | null;
  deleted_at: string | null;
  // 'manual' = Post Now button, 'auto' = scheduler, null = not yet posted
  posting_source: "manual" | "auto" | null;
  // Brand workspace this reel belongs to (default 'gotjesus')
  workspace_key: string;
  // Batch campaign provenance — null for Content Engine reels
  source: string | null;
  batch_id: string | null;
  campaign_item_id: string | null;
  ad_type: string | null;
  hook: string | null;
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

/**
 * Insert a new reel row.
 *
 * Uses a plain .insert() — NOT .insert().select().single().
 * With RLS enabled, the subsequent SELECT is blocked by the policy even for
 * service-role clients in some Supabase configurations, which causes
 * "no row returned" errors even though the insert succeeded.
 *
 * The caller must supply the id (use randomUUID() before calling).
 * Returns a Reel built from the input data + server-side defaults.
 */
export async function createReel(data: CreateReelInput): Promise<Reel> {
  if (!data.id) throw new Error("createReel: data.id is required");

  console.log(`[reels-db] inserting reel row ${data.id}`);
  const supabase = getClient();

  const { error } = await supabase.from("gotjesus_reels").insert(data);

  if (error) {
    console.error(`[reels-db] insert error for reel ${data.id}:`, error.message, error);
    throw new Error(`createReel failed: ${error.message}`);
  }

  console.log(`[reels-db] reel row inserted ${data.id}`);

  // Return a Reel constructed from input — we don't re-fetch to avoid RLS SELECT issues
  return {
    id: data.id,
    created_at: new Date().toISOString(),
    generation_source: data.generation_source ?? "manual",
    scheduled_for: data.scheduled_for ?? null,
    kie_task_id: data.kie_task_id ?? null,
    kie_video_url: data.kie_video_url ?? null,
    saved_video_url: data.saved_video_url ?? null,
    prompt_used: data.prompt_used ?? null,
    caption_used: data.caption_used,
    status: data.status,
    blotato_status: data.blotato_status ?? null,
    instagram_enabled: data.instagram_enabled ?? false,
    tiktok_enabled: data.tiktok_enabled ?? false,
    youtube_enabled: data.youtube_enabled ?? false,
    instagram_post_submission_id: data.instagram_post_submission_id ?? null,
    tiktok_post_submission_id: data.tiktok_post_submission_id ?? null,
    youtube_post_submission_id: data.youtube_post_submission_id ?? null,
    instagram_post_status: data.instagram_post_status ?? null,
    tiktok_post_status: data.tiktok_post_status ?? null,
    youtube_post_status: data.youtube_post_status ?? null,
    instagram_post_url: data.instagram_post_url ?? null,
    tiktok_post_url: data.tiktok_post_url ?? null,
    youtube_post_url: data.youtube_post_url ?? null,
    instagram_error: data.instagram_error ?? null,
    tiktok_error: data.tiktok_error ?? null,
    youtube_error: data.youtube_error ?? null,
    error_message: data.error_message ?? null,
    is_favorite: data.is_favorite ?? false,
    content_slot_key: data.content_slot_key ?? null,
    content_slot_name: data.content_slot_name ?? null,
    deleted_at: data.deleted_at ?? null,
    posting_source: data.posting_source ?? null,
    workspace_key: data.workspace_key ?? "gotjesus",
    source: data.source ?? null,
    batch_id: data.batch_id ?? null,
    campaign_item_id: data.campaign_item_id ?? null,
    ad_type: data.ad_type ?? null,
    hook: data.hook ?? null,
  };
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
  if (error) {
    console.error(`[reels-db] updateReel(${id}) error:`, error.message, error);
    throw new Error(`updateReel(${id}) failed: ${error.message}`);
  }
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

export async function getRecentReels(
  limit = 50,
  workspaceKey = "gotjesus"
): Promise<Reel[]> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("gotjesus_reels")
    .select("*")
    .is("deleted_at", null) // exclude soft-deleted
    .eq("workspace_key", workspaceKey)
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
