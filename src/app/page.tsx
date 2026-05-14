import Image from "next/image";
import VideoEngine from "@/components/VideoEngine";
import BannerImageEditor from "@/components/BannerImageEditor";
import { isBlotatoConnected } from "@/lib/blotato";
import { CROSS_DISCOVERY_PROMPT, CROSS_DISCOVERY_PROMPT_SUMMARY } from "@/lib/cross-prompt";
import { getPostingSettings } from "@/lib/posting-settings";
import { getBrandSettings } from "@/lib/brand-settings";

export default async function Home() {
  // All env/server logic runs here — nothing secret leaks to the client bundle
  const blotatoConnected = isBlotatoConnected();
  const resolution = process.env.KIE_VIDEO_RESOLUTION || "480p";
  const initialSettings = await getPostingSettings();
  const brandSettings = await getBrandSettings("gotjesus");
  const heroImage = brandSettings.bannerImageUrl;

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex flex-col">

      {/* ── Dashboard Header ────────────────────────────────────────────────── */}
      <header className="w-full border-b border-neutral-800 bg-neutral-950">
        <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          {/* Left — brand + title */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-semibold tracking-widest uppercase text-neutral-500">
              User Dashboard
            </span>
            <h1 className="text-xl font-bold tracking-tight text-white leading-tight">
              GotJesus Reel Engine
            </h1>
            <p className="text-xs text-neutral-500 leading-snug">
              Automated branded reel creation and social publishing
            </p>
          </div>

          {/* Right — status pills + avatar */}
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-center gap-0.5 bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 min-w-[100px]">
              <span className="text-[9px] font-semibold tracking-widest uppercase text-neutral-500">
                Credits
              </span>
              <span className="text-xs font-semibold text-emerald-400">
                Unlimited Beta
              </span>
            </div>

            {/* User avatar circle */}
            <div className="flex items-center gap-2.5 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2">
              {/* Initials avatar */}
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-neutral-600 to-neutral-800 border border-neutral-700 flex items-center justify-center flex-shrink-0">
                <span className="text-[11px] font-bold text-white tracking-wide select-none">
                  GJ
                </span>
              </div>
              <div className="flex flex-col gap-0">
                <span className="text-xs font-semibold text-white leading-tight">
                  GotJesus Admin
                </span>
                <span className="text-[10px] text-neutral-500 leading-tight">
                  Beta
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ── Main content ────────────────────────────────────────────────────── */}
      <main className="flex flex-col items-center flex-1">

        {/* ── Compact Banner ────────────────────────────────────────────────── */}
        <div className="w-full max-w-6xl mx-auto px-6 pt-6">
          <div
            className="relative w-full overflow-hidden rounded-2xl border border-neutral-800"
            style={{ height: "clamp(240px, 30vw, 320px)" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={heroImage}
              alt="GotJesus hero"
              className="w-full h-full object-cover object-top"
            />
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.55) 55%, rgba(10,10,10,0.96) 100%)",
              }}
            />
            {/* Update Banner control — top-right corner */}
            <BannerImageEditor initialBannerUrl={heroImage} />

            <div className="absolute bottom-0 left-0 right-0 px-6 pb-7 flex flex-col gap-2">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white drop-shadow-lg leading-tight">
                Create Automated GotJesus Reels
              </h2>
              <p className="text-xs sm:text-sm text-neutral-300 leading-relaxed max-w-lg drop-shadow">
                Generate vertical social videos, append the official end card,
                and prepare them for scheduled posting.
              </p>
            </div>
          </div>
        </div>

        {/* ── Dashboard Summary Cards ───────────────────────────────────────── */}
        <div className="w-full max-w-6xl mx-auto px-6 pt-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "User", value: "GotJesus Admin", accent: "text-white" },
              { label: "Credits", value: "Unlimited Beta", accent: "text-emerald-400" },
              { label: "Workspace", value: "Got Jesus?", accent: "text-white" },
              { label: "Automation", value: "Active", accent: "text-emerald-400" },
            ].map(({ label, value, accent }) => (
              <div
                key={label}
                className="bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-4 flex flex-col gap-1"
              >
                <span className="text-[10px] font-semibold tracking-widest uppercase text-neutral-500">
                  {label}
                </span>
                <span className={`text-sm font-semibold ${accent}`}>
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Video Engine ─────────────────────────────────────────────────── */}
        <div className="w-full max-w-xl mx-auto px-6 pt-8">
          <VideoEngine
            blotatoConnected={blotatoConnected}
            promptSummary={CROSS_DISCOVERY_PROMPT_SUMMARY}
            fullPrompt={CROSS_DISCOVERY_PROMPT}
            resolution={resolution}
            initialSettings={initialSettings}
          />
        </div>

        {/* ── End Card Asset ───────────────────────────────────────────────── */}
        <div className="w-full max-w-xl mx-auto px-6 pt-6 pb-10">
          <div className="w-full border border-neutral-800 rounded-2xl p-8 flex flex-col gap-6 bg-neutral-900">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold tracking-wide text-white">
                Official End Card Asset
              </h2>
              <p className="text-xs text-neutral-500">
                Official Got Jesus end card asset will be appended to every final
                video.
              </p>
            </div>

            <div className="flex flex-col items-center gap-4">
              <div className="relative w-36 rounded-xl overflow-hidden border border-neutral-700 shadow-lg">
                <Image
                  src="/gotjesus-endcard.png"
                  alt="Official Got Jesus end card"
                  width={941}
                  height={1672}
                  className="w-full h-auto"
                  priority
                />
              </div>
              <div className="flex flex-col items-center gap-1 text-center">
                <span className="text-xs font-medium text-emerald-500">
                  Asset confirmed
                </span>
                <span className="text-xs text-neutral-600">
                  gotjesus-endcard.png — 941 x 1672 px (9:16)
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-4 py-3">
              <p className="text-xs text-neutral-400 leading-relaxed">
                <span className="text-neutral-300 font-medium">
                  Video pipeline order:
                </span>{" "}
                Kie.ai Seedance 2.0 generates the main vertical content, then
                FFmpeg appends this end card — centered, full-frame, clean hold.
              </p>
            </div>
          </div>
        </div>

      </main>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="w-full border-t border-neutral-800 bg-neutral-950">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col items-center gap-2 text-center">
          <span className="text-sm font-semibold text-neutral-300">
            GotJesus Reel Engine
          </span>
          <p className="text-xs text-neutral-500 max-w-sm leading-relaxed">
            Automated branded reel generation for GotJesus social content.
          </p>
          <p className="text-[11px] text-neutral-700 max-w-md leading-relaxed">
            Built for repeatable 9:16 reel creation, branded end cards, and
            scheduled social publishing.
          </p>
        </div>
      </footer>

    </div>
  );
}
