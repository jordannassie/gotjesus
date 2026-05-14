"use client";

interface Props {
  blotatoConnected: boolean;
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

export default function ConnectionsTab({ blotatoConnected }: Props) {
  return (
    <div className="flex flex-col gap-6">
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
