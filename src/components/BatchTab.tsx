"use client";

import { getWorkspaceName } from "@/lib/workspaces";

interface Props {
  workspaceKey?: string;
}

const HOW_IT_WORKS = [
  {
    step: "1",
    label: "OpenAI writes the batch",
    detail: "Generates 10–30 video concepts from your reference image and campaign brief.",
  },
  {
    step: "2",
    label: "Seedance creates the videos",
    detail: "Each concept is sent to Kie.ai / Seedance 2.0 and rendered as a 9:16 reel.",
  },
  {
    step: "3",
    label: "Library stores the campaign",
    detail: "All generated reels are saved under this brand's Library for review.",
  },
  {
    step: "4",
    label: "You post the winners",
    detail: "Pick your favourites in Library and hit Post Now. Nothing posts automatically.",
  },
];

export default function BatchTab({ workspaceKey = "gotjesus" }: Props) {
  const brandName = getWorkspaceName(workspaceKey);

  return (
    <div className="flex flex-col gap-6">

      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold tracking-widest uppercase text-neutral-600">Batch</span>
          <span className="text-[10px] text-neutral-700">—</span>
          <span className="text-[10px] font-semibold text-neutral-400">{brandName}</span>
        </div>
        <h2 className="text-base font-bold text-white tracking-tight">Batch Campaign Builder</h2>
        <p className="text-xs text-neutral-500 leading-relaxed max-w-lg">
          Upload one image. Generate a full campaign. Review and post your favorites.
        </p>
      </div>

      {/* How it works */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {HOW_IT_WORKS.map(({ step, label, detail }) => (
          <div
            key={step}
            className="flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-4"
          >
            <div className="flex items-center gap-2">
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                style={{
                  background: "linear-gradient(135deg, #a3e635, #22d3ee)",
                  color: "#000",
                }}
              >
                {step}
              </span>
              <span className="text-[11px] font-semibold text-neutral-200 leading-snug">{label}</span>
            </div>
            <p className="text-[10px] text-neutral-600 leading-relaxed">{detail}</p>
          </div>
        ))}
      </div>

      {/* Campaign Builder card — all controls disabled */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-950 overflow-hidden">

        {/* Card header */}
        <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">New Batch Campaign</h3>
            <p className="text-xs text-neutral-600 mt-0.5">Configure your campaign below — generation coming soon.</p>
          </div>
          <span className="text-[10px] font-semibold px-2 py-1 rounded-md border border-neutral-700 text-neutral-600 bg-neutral-900">
            Coming Soon
          </span>
        </div>

        <div className="px-5 py-5 flex flex-col gap-5">

          {/* Reference Image */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
              Reference Image
            </label>
            <div className="w-full rounded-xl border border-dashed border-neutral-800 bg-neutral-900/40 px-4 py-8 flex flex-col items-center justify-center gap-2 opacity-50 cursor-not-allowed">
              <svg className="w-6 h-6 text-neutral-600" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
              </svg>
              <span className="text-xs text-neutral-600">Upload reference image</span>
              <span className="text-[10px] text-neutral-700">JPG, PNG, WebP — used as visual style anchor</span>
            </div>
          </div>

          {/* Campaign Instruction */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
              Campaign Brief
            </label>
            <textarea
              disabled
              placeholder="Describe the campaign goal, tone, audience, and key message. OpenAI will write 10–30 individual video concepts from this brief."
              rows={4}
              className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-sm text-neutral-700 placeholder-neutral-700 resize-none outline-none cursor-not-allowed opacity-50 leading-relaxed"
            />
          </div>

          {/* Batch Type */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
              Batch Type
            </label>
            <div className="flex flex-wrap gap-2">
              {["Product Launch", "UGC Style", "Faith / Devotional", "Educational", "Custom"].map((type) => (
                <button
                  key={type}
                  type="button"
                  disabled
                  className="px-3 py-1.5 rounded-lg border border-neutral-800 text-xs text-neutral-700 bg-neutral-900 cursor-not-allowed opacity-50"
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Batch Size */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
              Batch Size
            </label>
            <div className="flex items-center gap-2">
              {[10, 20, 30].map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled
                  className="px-4 py-1.5 rounded-lg border border-neutral-800 text-xs text-neutral-700 bg-neutral-900 cursor-not-allowed opacity-50"
                >
                  {n} videos
                </button>
              ))}
            </div>
          </div>

          {/* Generate button */}
          <div className="flex items-center justify-between pt-1">
            <p className="text-[11px] text-neutral-600 leading-relaxed max-w-xs">
              Batch generation will be enabled in a future update.
            </p>
            <button
              type="button"
              disabled
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-neutral-800 text-neutral-600 text-sm font-semibold cursor-not-allowed opacity-60"
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
              </svg>
              Generate Batch Plan
            </button>
          </div>

        </div>
      </div>

      {/* Empty state */}
      <div className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/30 px-6 py-10 flex flex-col items-center justify-center gap-3 text-center">
        <svg className="w-8 h-8 text-neutral-700" viewBox="0 0 20 20" fill="currentColor">
          <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
        </svg>
        <p className="text-sm text-neutral-600">Your batch concepts will appear here.</p>
        <p className="text-xs text-neutral-700 max-w-xs leading-relaxed">
          Once batch generation is enabled, your campaign videos will populate this grid for review before posting.
        </p>
      </div>

      {/* Safety note */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 px-5 py-4 flex items-start gap-3">
        <svg className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold text-neutral-300">Nothing posts automatically.</span>
          <p className="text-xs text-neutral-500 leading-relaxed">
            Batch videos save to Library for review. You choose which ones to post using the Post Now button.
          </p>
        </div>
      </div>

    </div>
  );
}
