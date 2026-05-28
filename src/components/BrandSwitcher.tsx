"use client";

import { useRouter } from "next/navigation";
import { WORKSPACES } from "@/lib/workspaces";

interface Props {
  workspaceKey: string;
}

export default function BrandSwitcher({ workspaceKey }: Props) {
  const router = useRouter();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value;
    router.push(`/?workspace=${next}`);
  };

  return (
    <div className="flex items-center gap-2 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2">
      <span className="text-[9px] font-semibold tracking-widest uppercase text-neutral-500 shrink-0">
        Brand
      </span>
      <select
        value={workspaceKey}
        onChange={handleChange}
        className="text-xs font-semibold text-white bg-transparent outline-none cursor-pointer min-w-[100px]"
      >
        {WORKSPACES.map((w) => (
          <option key={w.key} value={w.key} className="bg-neutral-900 text-white">
            {w.name}
          </option>
        ))}
      </select>
      <svg
        className="w-3 h-3 text-neutral-500 shrink-0 pointer-events-none"
        viewBox="0 0 20 20"
        fill="currentColor"
      >
        <path
          fillRule="evenodd"
          d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
          clipRule="evenodd"
        />
      </svg>
    </div>
  );
}
