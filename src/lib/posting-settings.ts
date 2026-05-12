/**
 * Posting settings — server-side only.
 *
 * Reads and writes the single gotjesus_posting_settings row in Supabase.
 * Degrades gracefully to DEFAULT_SETTINGS if Supabase is not configured or
 * the table does not yet exist. The first successful GET creates the row.
 *
 * Required SQL (run once in Supabase SQL Editor):
 *   See the SQL block in /supabase/schema.sql or provided in project docs.
 */

import { createClient } from "@supabase/supabase-js";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface PostingSettings {
  id?: string;
  autoPostEnabled: boolean;
  instagramEnabled: boolean;
  tiktokEnabled: boolean;
  youtubeEnabled: boolean;
  postsPerDay: number;
  /** Array of HH:MM strings in 24-hour format, e.g. ["09:00","13:00","19:00"] */
  postingTimes: string[];
  /** IANA timezone — default: "America/Los_Angeles" */
  timezone: string;
}

export const DEFAULT_SETTINGS: PostingSettings = {
  autoPostEnabled: false,
  instagramEnabled: true,
  tiktokEnabled: true,
  youtubeEnabled: true,
  postsPerDay: 3,
  postingTimes: ["09:00", "13:00", "19:00"],
  timezone: "America/Los_Angeles",
};

// ─── DB row shape ─────────────────────────────────────────────────────────────

interface DbRow {
  id: string;
  created_at: string;
  updated_at: string;
  auto_post_enabled: boolean;
  instagram_enabled: boolean;
  tiktok_enabled: boolean;
  youtube_enabled: boolean;
  posts_per_day: number;
  posting_times: string[];
  timezone: string;
}

type DbUpdate = {
  updated_at?: string;
  auto_post_enabled?: boolean;
  instagram_enabled?: boolean;
  tiktok_enabled?: boolean;
  youtube_enabled?: boolean;
  posts_per_day?: number;
  posting_times?: string[];
  timezone?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function rowToSettings(row: DbRow): PostingSettings {
  return {
    id: row.id,
    autoPostEnabled: row.auto_post_enabled,
    instagramEnabled: row.instagram_enabled,
    tiktokEnabled: row.tiktok_enabled,
    youtubeEnabled: row.youtube_enabled,
    postsPerDay: row.posts_per_day,
    postingTimes: Array.isArray(row.posting_times)
      ? row.posting_times
      : DEFAULT_SETTINGS.postingTimes,
    timezone: row.timezone ?? DEFAULT_SETTINGS.timezone,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns current posting settings. If no row exists, inserts defaults and
 * returns them. Falls back to DEFAULT_SETTINGS on any error.
 */
export async function getPostingSettings(): Promise<PostingSettings> {
  const supabase = getClient();
  if (!supabase) return DEFAULT_SETTINGS;

  try {
    const { data, error } = await supabase
      .from("gotjesus_posting_settings")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn("[posting-settings] read error:", error.message);
      return DEFAULT_SETTINGS;
    }

    if (!data) {
      // No row yet — insert one with all DB defaults
      const { data: inserted, error: insertErr } = await supabase
        .from("gotjesus_posting_settings")
        .insert({})
        .select()
        .single();

      if (insertErr || !inserted) {
        console.warn("[posting-settings] insert defaults error:", insertErr?.message);
        return DEFAULT_SETTINGS;
      }
      return rowToSettings(inserted as DbRow);
    }

    return rowToSettings(data as DbRow);
  } catch (err) {
    console.warn("[posting-settings] getPostingSettings exception:", err);
    return DEFAULT_SETTINGS;
  }
}

/**
 * Partially updates the posting settings row. Creates the row first if it does
 * not exist. Returns the updated settings on success, or a merged local copy on
 * any error.
 */
export async function updatePostingSettings(
  settings: Partial<PostingSettings>
): Promise<PostingSettings> {
  const supabase = getClient();
  if (!supabase) return { ...DEFAULT_SETTINGS, ...settings };

  try {
    const current = await getPostingSettings();

    const updates: DbUpdate = {
      updated_at: new Date().toISOString(),
    };
    if (settings.autoPostEnabled !== undefined)
      updates.auto_post_enabled = settings.autoPostEnabled;
    if (settings.instagramEnabled !== undefined)
      updates.instagram_enabled = settings.instagramEnabled;
    if (settings.tiktokEnabled !== undefined)
      updates.tiktok_enabled = settings.tiktokEnabled;
    if (settings.youtubeEnabled !== undefined)
      updates.youtube_enabled = settings.youtubeEnabled;
    if (settings.postsPerDay !== undefined)
      updates.posts_per_day = settings.postsPerDay;
    if (settings.postingTimes !== undefined)
      updates.posting_times = settings.postingTimes;
    if (settings.timezone !== undefined)
      updates.timezone = settings.timezone;

    if (!current.id) {
      // No existing row — insert with specified values
      const { data, error } = await supabase
        .from("gotjesus_posting_settings")
        .insert(updates)
        .select()
        .single();
      if (error || !data) return { ...DEFAULT_SETTINGS, ...settings };
      return rowToSettings(data as DbRow);
    }

    const { data, error } = await supabase
      .from("gotjesus_posting_settings")
      .update(updates)
      .eq("id", current.id)
      .select()
      .single();

    if (error || !data) {
      console.warn("[posting-settings] update error:", error?.message);
      return { ...current, ...settings };
    }
    return rowToSettings(data as DbRow);
  } catch (err) {
    console.warn("[posting-settings] updatePostingSettings exception:", err);
    return { ...DEFAULT_SETTINGS, ...settings };
  }
}
