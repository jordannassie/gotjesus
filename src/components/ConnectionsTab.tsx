"use client";

import VideoEngine from "@/components/VideoEngine";
import type { PostingSettings } from "@/lib/posting-settings";

interface Props {
  blotatoConnected: boolean;
  promptSummary: string;
  fullPrompt: string;
  resolution: string;
  initialSettings: PostingSettings;
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
  const text = status === "connected" ? "Connected" : status === "active" ? "Active" : "Not connected";

  return (
    <div className="flex items-center justify-between py-3 border-b border-neutral-800 last:border-b-0">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm text-white font-medium">{label}</span>
        {sublabel && <span className="text-xs text-neutral-500">{sublabel}</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
        <span className={`text-xs font-medium ${status !== "disconnected" ? "text-emerald-400" : "text-red-400"}`}>
          {text}
        </span>
      </div>
    </div>
  );
}

export default function ConnectionsTab({
  blotatoConnected,
  promptSummary,
  fullPrompt,
  resolution,
  initialSettings,
}: Props) {
  const kieConfigured = typeof process !== "undefined"
    ? true
    : false;

  return (
    <div className="flex flex-col gap-6">
      {/* Generation Stack */}
      <div className="border border-neutral-800 rounded-2xl bg-neutral-950 overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-800">
          <h3 className="text-sm font-semibold text-white">Generation Stack</h3>
          <p className="text-xs text-neutral-500 mt-0.5">AI video generation and asset pipeline</p>
        </div>
        <div className="px-5">
          <StatusRow
            label="Kie.ai — Seedance 2.0 Fast"
            sublabel="Bytedance model via Kie.ai API"
            status="connected"
          />
          <StatusRow
            label="GotJesus Branded Ending"
            sublabel="End card appended to every reel via reference image"
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
          <p className="text-xs text-neutral-500 mt-0.5">Blotato distributes reels to connected platforms</p>
        </div>
        <div className="px-5">
          <StatusRow
            label="Blotato"
            sublabel="Publishing API v2 — cross-platform distribution"
            status={blotatoConnected ? "connected" : "disconnected"}
          />
        </div>
      </div>

      {/* Automation + Manual Generate */}
      <div className="border border-neutral-800 rounded-2xl bg-neutral-950 overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-800">
          <h3 className="text-sm font-semibold text-white">Automation &amp; Manual Generate</h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            Daily schedule is controlled per-slot in the Content Engine tab. Use the panel below to manually trigger a reel.
          </p>
        </div>
        <div className="px-5 py-5">
          <VideoEngine
            blotatoConnected={blotatoConnected}
            promptSummary={promptSummary}
            fullPrompt={fullPrompt}
            resolution={resolution}
            initialSettings={initialSettings}
          />
        </div>
      </div>
    </div>
  );
}
