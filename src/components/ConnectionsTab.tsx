"use client";

import { getWorkspaceName } from "@/lib/workspaces";

interface Props {
  blotatoConnected: boolean;
  facebookConfigured?: boolean;
  workspaceKey?: string;
}

function StatusRow({
  label,
  sublabel,
  status,
}: {
  label: string;
  sublabel?: string;
  status: "connected" | "active" | "disconnected";
}) {
  const dot =
    status === "connected" || status === "active"
      ? "bg-emerald-500"
      : "bg-red-500";
  const text =
    status === "connected"
      ? "Connected"
      : status === "active"
      ? "Active"
      : "Not connected";

  return (
    <div className="flex items-center justify-between py-3 border-b border-neutral-800 last:border-b-0">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm text-white font-medium">{label}</span>
        {sublabel && <span className="text-xs text-neutral-500">{sublabel}</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
        <span
          className={`text-xs font-medium ${
            status !== "disconnected" ? "text-emerald-400" : "text-red-400"
          }`}
        >
          {text}
        </span>
      </div>
    </div>
  );
}

function NativePlatformCard({ platform, icon }: { platform: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-neutral-800 last:border-b-0">
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-lg bg-neutral-800 border border-neutral-700 flex items-center justify-center text-neutral-500 flex-shrink-0">
          {icon}
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-neutral-300 font-medium">{platform}</span>
          <span className="text-[11px] text-neutral-600">Native API — coming soon</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-neutral-700" />
          <span className="text-xs font-medium text-neutral-600">Not connected</span>
        </div>
        <button
          type="button"
          disabled
          className="px-3 py-1.5 rounded-lg border border-neutral-800 text-[11px] font-medium text-neutral-700 cursor-not-allowed"
        >
          Setup Later
        </button>
      </div>
    </div>
  );
}

export default function ConnectionsTab({ blotatoConnected, facebookConfigured = false, workspaceKey = "gotjesus" }: Props) {
  const brandName = getWorkspaceName(workspaceKey);

  return (
    <div className="flex flex-col gap-6">
      {/* Workspace label */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold tracking-widest uppercase text-neutral-600">Connections</span>
        <span className="text-[10px] text-neutral-700">—</span>
        <span className="text-[10px] font-semibold text-neutral-400">{brandName}</span>
      </div>

      {/* Generation Stack */}
      <div className="border border-neutral-800 rounded-2xl bg-neutral-950 overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-800">
          <h3 className="text-sm font-semibold text-white">Generation Stack</h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            AI video generation and asset pipeline
          </p>
        </div>
        <div className="px-5">
          <StatusRow
            label="Kie.ai — Seedance 2.0 Fast"
            sublabel="Bytedance model via Kie.ai API"
            status="connected"
          />
          <StatusRow
            label="GotJesus Branded Ending"
            sublabel="End card appended to every reel via reference_image_urls"
            status="active"
          />
          <StatusRow
            label="Supabase Video Library"
            sublabel="Reels saved to GOT JESUS / gotjesus-videos / bucket"
            status="active"
          />
        </div>
      </div>

      {/* Social Publishing */}
      <div className="border border-neutral-800 rounded-2xl bg-neutral-950 overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-800">
          <h3 className="text-sm font-semibold text-white">Social Publishing</h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            Blotato distributes reels to connected platforms
          </p>
        </div>
        <div className="px-5">
          <StatusRow
            label="Blotato"
            sublabel="Publishing API v2 — cross-platform distribution"
            status={blotatoConnected ? "connected" : "disconnected"}
          />
          <StatusRow
            label="Instagram"
            sublabel="Via Blotato — BLOTATO_INSTAGRAM_ACCOUNT_ID"
            status={blotatoConnected ? "connected" : "disconnected"}
          />
          <StatusRow
            label="Facebook"
            sublabel={
              facebookConfigured
                ? "Via Blotato — Account ID 34233, Page ID 1126460550555241"
                : "Requires BLOTATO_FACEBOOK_ACCOUNT_ID + BLOTATO_FACEBOOK_PAGE_ID"
            }
            status={facebookConfigured ? "connected" : "disconnected"}
          />
          <StatusRow
            label="TikTok"
            sublabel="Via Blotato — BLOTATO_TIKTOK_ACCOUNT_ID"
            status={blotatoConnected ? "connected" : "disconnected"}
          />
          <StatusRow
            label="YouTube"
            sublabel="Via Blotato — BLOTATO_YOUTUBE_ACCOUNT_ID"
            status={blotatoConnected ? "connected" : "disconnected"}
          />
        </div>
        {facebookConfigured && (
          <div className="px-5 py-3 border-t border-neutral-800 bg-neutral-900/30">
            <p className="text-[11px] text-emerald-600/80 leading-relaxed">
              Facebook connected: Got Jesus? page via Blotato. Posts as Reels to{" "}
              <span className="text-emerald-500">facebook.com/gotjesusco</span>
            </p>
          </div>
        )}
        {!facebookConfigured && blotatoConnected && (
          <div className="px-5 py-3 border-t border-neutral-800 bg-neutral-900/30">
            <p className="text-[11px] text-neutral-600 leading-relaxed">
              Facebook requires a connected Facebook account ID and Page ID from Blotato.
              Add <code className="text-neutral-400 bg-neutral-800 px-1 py-0.5 rounded text-[10px]">BLOTATO_FACEBOOK_ACCOUNT_ID</code> and{" "}
              <code className="text-neutral-400 bg-neutral-800 px-1 py-0.5 rounded text-[10px]">BLOTATO_FACEBOOK_PAGE_ID</code> to Netlify env vars.
            </p>
          </div>
        )}
      </div>

      {/* Native Social Connections */}
      <div className="border border-neutral-800 rounded-2xl bg-neutral-950 overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-800">
          <h3 className="text-sm font-semibold text-white">Native Social Connections</h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            Coming next: connect <span className="text-neutral-300">{brandName}</span> directly to its own Instagram, Facebook, TikTok, and YouTube accounts via direct OAuth.
          </p>
        </div>
        <div className="px-5">
          <NativePlatformCard
            platform="Instagram"
            icon={
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
              </svg>
            }
          />
          <NativePlatformCard
            platform="Facebook"
            icon={
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
              </svg>
            }
          />
          <NativePlatformCard
            platform="TikTok"
            icon={
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.27 8.27 0 004.84 1.55V6.79a4.85 4.85 0 01-1.07-.1z"/>
              </svg>
            }
          />
          <NativePlatformCard
            platform="YouTube"
            icon={
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
            }
          />
        </div>
        <div className="px-5 py-3 border-t border-neutral-800 bg-neutral-900/30">
          <p className="text-[11px] text-neutral-600 leading-relaxed">
            Blotato remains active for posting. Native OAuth connections will be added one platform at a time.
          </p>
        </div>
      </div>

      {/* Info note */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 px-5 py-4">
        <p className="text-xs text-neutral-500 leading-relaxed">
          <span className="text-neutral-300 font-medium">Scheduling note:</span>{" "}
          Daily automation is fully slot-based. Each slot in the{" "}
          <span className="text-neutral-300">Content Engine</span> tab has its own
          scheduled time, prompt, and reference images.{" "}
          <code className="text-neutral-400 bg-neutral-800 px-1 py-0.5 rounded text-[10px]">
            gotjesus_content_slots
          </code>{" "}
          is the only source of truth for automation schedules — there is no legacy
          global posting_times fallback.
        </p>
      </div>
    </div>
  );
}
