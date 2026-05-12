import Image from "next/image";

export default function Home() {
  const statusRows = [
    { label: "Kie.ai Seedance 2.0", status: "Not Connected Yet" },
    { label: "Got Jesus? Logo End Card", status: "Asset Ready" },
    { label: "Blotato Social Posting", status: "Not Connected Yet" },
  ];

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

        {/* Main Card */}
        <div className="w-full border border-neutral-800 rounded-2xl p-8 flex flex-col gap-6 bg-neutral-950">
          <h2 className="text-lg font-semibold tracking-wide text-white">
            Cross Discovery Video Engine
          </h2>

          <div className="flex flex-col gap-3">
            {statusRows.map(({ label, status }) => (
              <div
                key={label}
                className="flex items-center justify-between py-3 px-4 rounded-lg border border-neutral-800 bg-neutral-900"
              >
                <span className="text-sm text-neutral-300">{label}</span>
                <span
                  className={`text-xs font-medium ${
                    status === "Asset Ready"
                      ? "text-emerald-500"
                      : "text-neutral-500"
                  }`}
                >
                  {status}
                </span>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="mt-2 w-full py-3 px-6 rounded-lg bg-white text-black text-sm font-semibold tracking-wide hover:bg-neutral-200 transition-colors duration-150 cursor-not-allowed"
            disabled
          >
            Build Video Engine Next
          </button>
        </div>

        {/* End Card Asset Section */}
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
            {/* 9:16 preview frame */}
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

        {/* Footer note */}
        <p className="text-xs text-neutral-600 text-center">
          Step 1 complete: Next.js + Netlify foundation.
        </p>
      </div>
    </main>
  );
}
