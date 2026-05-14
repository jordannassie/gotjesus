/**
 * Brand / workspace settings — server-side only.
 *
 * Reads and writes the gotjesus_brand_settings table in Supabase.
 * Currently a single-row table keyed by workspace_key = 'gotjesus'.
 * Designed to evolve into per-company brand settings when multi-workspace
 * support is added.
 *
 * Required SQL (run once in Supabase SQL Editor):
 *   See gotjesus_brand_settings in /supabase/schema.sql
 */

import { createClient } from "@supabase/supabase-js";

// ─── Default banner — the original hero image URL ─────────────────────────────

export const DEFAULT_BANNER_URL =
  "https://phhczohqidgrvcmszets.supabase.co/storage/v1/object/public/GOT%20JESUS/image/89D706C1-5DDB-423C-A225-63645A926841.jpg";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BrandSettings {
  id?: string;
  workspaceKey: string;
  bannerImageUrl: string;
  bannerImagePath?: string | null;
}

interface DbRow {
  id: string;
  created_at: string;
  updated_at: string;
  workspace_key: string;
  banner_image_url: string | null;
  banner_image_path: string | null;
}

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

function rowToSettings(row: DbRow): BrandSettings {
  return {
    id: row.id,
    workspaceKey: row.workspace_key,
    bannerImageUrl: row.banner_image_url ?? DEFAULT_BANNER_URL,
    bannerImagePath: row.banner_image_path,
  };
}

const DEFAULT_SETTINGS: BrandSettings = {
  workspaceKey: "gotjesus",
  bannerImageUrl: DEFAULT_BANNER_URL,
  bannerImagePath: null,
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns brand settings for the given workspace.
 * Falls back to DEFAULT_SETTINGS gracefully if Supabase is unavailable or the
 * table does not yet exist — safe for server rendering.
 */
export async function getBrandSettings(
  workspaceKey = "gotjesus"
): Promise<BrandSettings> {
  const supabase = getClient();
  if (!supabase) return { ...DEFAULT_SETTINGS, workspaceKey };

  try {
    const { data, error } = await supabase
      .from("gotjesus_brand_settings")
      .select("*")
      .eq("workspace_key", workspaceKey)
      .maybeSingle();

    if (error) {
      console.warn("[brand-settings] read error:", error.message);
      return { ...DEFAULT_SETTINGS, workspaceKey };
    }

    if (!data) return { ...DEFAULT_SETTINGS, workspaceKey };
    return rowToSettings(data as DbRow);
  } catch (err) {
    console.warn("[brand-settings] getBrandSettings exception:", err);
    return { ...DEFAULT_SETTINGS, workspaceKey };
  }
}

/**
 * Creates or updates the banner image for a workspace.
 * Throws a real Error if the database save fails — never silently pretends
 * success so callers can return a proper HTTP 500.
 */
export async function updateBannerImageSettings({
  workspaceKey = "gotjesus",
  bannerImageUrl,
  bannerImagePath,
}: {
  workspaceKey?: string;
  bannerImageUrl: string;
  bannerImagePath?: string | null;
}): Promise<BrandSettings> {
  const supabase = requireClient();

  const payload = {
    workspace_key: workspaceKey,
    banner_image_url: bannerImageUrl,
    banner_image_path: bannerImagePath ?? null,
    updated_at: new Date().toISOString(),
  };

  // Upsert on the unique workspace_key column
  const { data, error } = await supabase
    .from("gotjesus_brand_settings")
    .upsert(payload, { onConflict: "workspace_key" })
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to save banner settings: ${error?.message ?? "no data returned"}`
    );
  }

  console.log("[brand-settings] Banner updated for workspace:", workspaceKey);
  return rowToSettings(data as DbRow);
}
