import Image from "next/image";
import VideoEngine from "@/components/VideoEngine";
import { isBlotatoConnected } from "@/lib/blotato";
import { CROSS_DISCOVERY_PROMPT, CROSS_DISCOVERY_PROMPT_SUMMARY } from "@/lib/cross-prompt";
import { getPostingSettings } from "@/lib/posting-settings";

export default async function Home() {
  // All env/server logic runs here — nothing secret leaks to the client bundle
  const blotatoConnected = isBlotatoConnected();
  const resolution = process.env.KIE_VIDEO_RESOLUTION || "480p";
  const initialSettings = await getPostingSettings();

  return (
    <main className="flex flex-col items-center justify-center min-h-screen px-6 py-16">
      <div className="w-full max-w-xl flex flex-col items-center gap-10">
        {/* Header */}
        <div className="text-center flex flex-col gap-4">
          <h1 className="text-4xl font-bold tracking-tight leading-tight">
            GotJesus Reel Engine
          </h1>
          <p className="text-sm text-neutral-400 leading-relaxed max-w-sm mx-auto">
            Generate viral 9:16 Got Jesus? reels, add the official logo end
            card, and schedule them for social posting.
          </p>
        </div>

        {/* Interactive engine — client component, server-provided props */}
        <VideoEngine
          blotatoConnected={blotatoConnected}
          promptSummary={CROSS_DISCOVERY_PROMPT_SUMMARY}
          fullPrompt={CROSS_DISCOVERY_PROMPT}
          resolution={resolution}
          initialSettings={initialSettings}
        />

        {/* End Card Asset */}
        <div className="w-full border border-neutral-800 rounded-2xl p-8 flex flex-col gap-6 bg-neutral-950">
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

          <div className="rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3">
            <p className="text-xs text-neutral-400 leading-relaxed">
              <span className="text-neutral-300 font-medium">
                Video pipeline order:
              </span>{" "}
              Kie.ai Seedance 2.0 generates the main vertical content, then
              FFmpeg appends this end card — centered, full-frame, clean hold.
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-xs text-neutral-600 text-center">
          Kie-native branded ending — 8-second single-step generation.
        </p>
      </div>
    </main>
  );
}
