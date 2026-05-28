import BannerImageEditor from "@/components/BannerImageEditor";
import BrandSwitcher from "@/components/BrandSwitcher";
import EndCardEditor from "@/components/EndCardEditor";
import DashboardTabs from "@/components/DashboardTabs";
import { isBlotatoConnected } from "@/lib/blotato";
import { getBrandSettings } from "@/lib/brand-settings";
import { getContentSlots, seedDefaultContentSlotsIfMissing } from "@/lib/content-slots";
import { normalizeWorkspaceKey, getWorkspaceByKey } from "@/lib/workspaces";

// Force server-side rendering on every request so getBrandSettings() and
// getPostingSettings() always return fresh data from Supabase, and
// router.refresh() after a banner upload actually re-fetches live values.
export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  const params = await searchParams;
  const workspaceKey = normalizeWorkspaceKey(params.workspace);
  const workspace = getWorkspaceByKey(workspaceKey);

  const blotatoConnected = isBlotatoConnected();
  const brandSettings = await getBrandSettings("gotjesus");
  const heroImage = brandSettings.bannerImageUrl;
  const activeEndCardUrl =
    brandSettings.endCardImageUrl ??
    process.env.GOT_JESUS_ENDCARD_SUPABASE_URL ??
    "/gotjesus-endcard.png";
  await seedDefaultContentSlotsIfMissing(workspaceKey);
  const contentSlots = await getContentSlots(workspaceKey);

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex flex-col">

      {/* ── Dashboard Header ────────────────────────────────────────────────── */}
      <header className="w-full border-b border-neutral-800 bg-neutral-950">
        <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-semibold tracking-widest uppercase text-neutral-500">
              User Dashboard
            </span>
            <h1 className="text-xl font-bold tracking-tight text-white leading-tight">
              {workspace.name}
            </h1>
            <p className="text-xs text-neutral-500 leading-snug">
              Automated branded reel creation and social publishing
            </p>
          </div>

          <div className="flex items-center gap-3">
            <BrandSwitcher workspaceKey={workspaceKey} />
            <div className="flex flex-col items-center gap-0.5 bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 min-w-[100px]">
              <span className="text-[9px] font-semibold tracking-widest uppercase text-neutral-500">
                Credits
              </span>
              <span className="text-xs font-semibold text-emerald-400">
                Unlimited Beta
              </span>
            </div>
            <div className="flex items-center gap-2.5 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                style={{
                  background: "linear-gradient(135deg, #a3e635, #22d3ee, #a855f7)",
                  boxShadow: "0 0 10px #22d3ee55, 0 0 4px #a3e63544",
                }}
              >
                <span className="text-[11px] font-bold text-black tracking-wide select-none">JN</span>
              </div>
              <div className="flex flex-col gap-0">
                <span className="text-xs font-semibold text-white leading-tight">Jordan Nassie</span>
                <span className="text-[10px] text-neutral-500 leading-tight">Beta</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ── Main content ────────────────────────────────────────────────────── */}
      <main className="flex flex-col flex-1">

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
            <BannerImageEditor initialBannerUrl={heroImage} />
            <div className="absolute bottom-0 left-0 right-0 px-6 pb-7 flex flex-col gap-2">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white drop-shadow-lg leading-tight">
                Got Jesus?
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
              { label: "User", value: "Jordan Nassie", accent: "text-white" },
              { label: "Credits", value: "Unlimited Beta", accent: "text-emerald-400" },
              { label: "Workspace", value: workspace.name, accent: "text-white" },
              { label: "Automation", value: "Active", accent: "text-emerald-400" },
            ].map(({ label, value, accent }) => (
              <div
                key={label}
                className="bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-4 flex flex-col gap-1"
              >
                <span className="text-[10px] font-semibold tracking-widest uppercase text-neutral-500">
                  {label}
                </span>
                <span className={`text-sm font-semibold ${accent}`}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Active Brand callout ──────────────────────────────────────────── */}
        <div className="w-full max-w-6xl mx-auto px-6 pt-4">
          <div className="flex items-start gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 px-5 py-3.5">
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-xs font-semibold text-white leading-snug">
                Active Brand:{" "}
                <span className="text-emerald-400">{workspace.name}</span>
              </span>
              <span className="text-[11px] text-neutral-500 leading-relaxed">
                {workspace.description}
              </span>
              <span className="text-[10px] text-neutral-600 leading-relaxed mt-0.5">
                Content Engine, Batch, Library, and Connections will be scoped to this brand.
              </span>
            </div>
          </div>
        </div>

        {/* ── Dashboard Tabs (Content Engine / Library / Connections) ──────── */}
        <div className="w-full max-w-6xl mx-auto px-6 pt-6">
          <DashboardTabs
            contentSlots={contentSlots}
            blotatoConnected={blotatoConnected}
            workspaceKey={workspaceKey}
          />
        </div>

        {/* ── Official End Card Asset ────────────────────────────────────────── */}
        <div className="w-full max-w-6xl mx-auto px-6 pb-10 pt-4">
          <div className="border border-neutral-800 rounded-2xl bg-neutral-900 px-6 py-5">
            <EndCardEditor currentEndCardUrl={activeEndCardUrl} />
          </div>
        </div>

      </main>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="w-full border-t border-neutral-800 bg-neutral-950">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col items-center gap-2 text-center">
          <span className="text-sm font-semibold text-neutral-300">GotJesus Reel Engine</span>
          <p className="text-xs text-neutral-500 max-w-sm leading-relaxed">
            Automated branded reel generation for GotJesus social content.
          </p>
          <p className="text-[11px] text-neutral-700 max-w-md leading-relaxed">
            Built for repeatable 9:16 reel creation, branded end cards, and scheduled social publishing.
          </p>
        </div>
      </footer>

    </div>
  );
}
