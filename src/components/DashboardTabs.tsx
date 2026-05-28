"use client";

import { useState, useTransition } from "react";
import DailyContentEngine from "@/components/DailyContentEngine";
import BatchTab from "@/components/BatchTab";
import LibraryTab from "@/components/LibraryTab";
import ConnectionsTab from "@/components/ConnectionsTab";
import type { ContentSlot } from "@/lib/content-slots";

type Tab = "engine" | "batch" | "library" | "connections";

interface Props {
  contentSlots: ContentSlot[];
  blotatoConnected: boolean;
  workspaceKey: string;
}

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  {
    key: "engine",
    label: "Content Engine",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    key: "batch",
    label: "Batch",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    key: "library",
    label: "Library",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
        <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
      </svg>
    ),
  },
  {
    key: "connections",
    label: "Connections",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
      </svg>
    ),
  },
];

function PageSpinner() {
  return (
    <div className="py-20 flex flex-col items-center justify-center gap-3">
      <div className="relative w-10 h-10">
        <div
          className="absolute inset-0 rounded-full animate-spin"
          style={{
            border: "2.5px solid transparent",
            borderTopColor: "#a3e635",
            borderRightColor: "#22d3ee",
            filter: "drop-shadow(0 0 6px #22d3ee) drop-shadow(0 0 10px #a3e635)",
            animationDuration: "0.9s",
          }}
        />
        <div
          className="absolute inset-2 rounded-full animate-spin"
          style={{
            border: "2px solid transparent",
            borderBottomColor: "#a855f7",
            borderLeftColor: "#22d3ee",
            filter: "drop-shadow(0 0 5px #a855f7)",
            animationDuration: "0.6s",
            animationDirection: "reverse",
          }}
        />
      </div>
      <span className="text-xs tracking-wide" style={{ color: "#22d3ee99" }}>Loading…</span>
    </div>
  );
}

export default function DashboardTabs({ contentSlots, blotatoConnected, workspaceKey }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("engine");
  const [isPending, startTransition] = useTransition();

  const handleTabChange = (key: Tab) => {
    startTransition(() => setActiveTab(key));
  };

  return (
    <div className="flex flex-col gap-0">
      {/* Tab navigation */}
      <div className="border-b border-neutral-800 flex items-center gap-0">
        {TABS.map(({ key, label, icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => handleTabChange(key)}
            className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === key
                ? "border-white text-white"
                : "border-transparent text-neutral-500 hover:text-neutral-300 hover:border-neutral-600"
            }`}
          >
            {icon}
            {label}
            {isPending && activeTab !== key && (
              <svg className="w-3 h-3 animate-spin opacity-40 ml-0.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className={`pt-6 pb-10 transition-opacity duration-150 ${isPending ? "opacity-50" : "opacity-100"}`}>
        {isPending ? (
          <PageSpinner />
        ) : activeTab === "engine" ? (
          <DailyContentEngine initialSlots={contentSlots} workspaceKey={workspaceKey} />
        ) : activeTab === "batch" ? (
          <BatchTab workspaceKey={workspaceKey} onSwitchToLibrary={() => handleTabChange("library")} />
        ) : activeTab === "library" ? (
          <LibraryTab workspaceKey={workspaceKey} />
        ) : (
          <ConnectionsTab blotatoConnected={blotatoConnected} workspaceKey={workspaceKey} />
        )}
      </div>
    </div>
  );
}
