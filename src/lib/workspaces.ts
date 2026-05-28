/**
 * Workspace / brand registry — static MVP definition.
 *
 * Each workspace maps to an isolated brand page inside the multi-brand reel
 * engine. For now this is a static list; no database brand_pages table is
 * needed yet. Content slots, reels, brand settings, and posting settings are
 * all already keyed by workspace_key in Supabase.
 *
 * Valid workspace keys: gotjesus | ugcfire | sellbop | godvo | 1billion
 */

export type WorkspaceKey =
  | "gotjesus"
  | "ugcfire"
  | "sellbop"
  | "godvo"
  | "1billion";

export interface Workspace {
  key: WorkspaceKey;
  name: string;
  description: string;
  /** Optional logo URL for future custom brand switcher UI. */
  logoUrl?: string;
}

export const WORKSPACES: Workspace[] = [
  {
    key: "gotjesus",
    name: "Got Jesus?",
    description: "Faith-based reels and apparel content.",
  },
  {
    key: "ugcfire",
    name: "UGCFire",
    description: "UGC ads, creator content, and brand campaigns.",
    logoUrl: "https://phhczohqidgrvcmszets.supabase.co/storage/v1/object/public/UGC%20Fire/images/UGCfirelog.png",
  },
  {
    key: "sellbop",
    name: "SellBop",
    description: "AI launch coach and digital product business content.",
  },
  {
    key: "godvo",
    name: "Godvo",
    description: "AI authorization and future governance content.",
  },
  {
    key: "1billion",
    name: "1Billion",
    description: "Gospel, discipleship, and ministry content.",
  },
];

const VALID_KEYS = new Set<string>(WORKSPACES.map((w) => w.key));

/**
 * Returns the workspace for the given key.
 * Falls back to gotjesus if the key is missing or unrecognised.
 */
export function getWorkspaceByKey(key?: string | null): Workspace {
  if (key && VALID_KEYS.has(key)) {
    return WORKSPACES.find((w) => w.key === key)!;
  }
  return WORKSPACES[0]; // gotjesus
}

/**
 * Returns the display name for a workspace key.
 * Falls back to "Got Jesus?" for unknown/missing keys.
 */
export function getWorkspaceName(key?: string | null): string {
  return getWorkspaceByKey(key).name;
}

/**
 * Coerces any string into a valid WorkspaceKey.
 * Returns "gotjesus" for any invalid or missing value.
 */
export function normalizeWorkspaceKey(key?: string | null): WorkspaceKey {
  return getWorkspaceByKey(key).key;
}
