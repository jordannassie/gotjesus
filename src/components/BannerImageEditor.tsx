"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  initialBannerUrl: string;
}

type UploadStatus = "idle" | "uploading" | "success" | "error";

export default function BannerImageEditor({ initialBannerUrl: _ }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");

  function handleButtonClick() {
    inputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so selecting the same file again re-triggers onChange
    e.target.value = "";

    setStatus("uploading");
    setErrorMsg("");

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/dashboard-banner", {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `Upload failed (${res.status})`
        );
      }

      setStatus("success");
      // Refresh server-rendered page data so the new banner URL is used
      router.refresh();

      // Reset status indicator after a couple of seconds
      setTimeout(() => setStatus("idle"), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed.";
      setErrorMsg(msg);
      setStatus("error");
    }
  }

  return (
    <>
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Button + status — positioned top-right inside the banner */}
      <div className="absolute top-3 right-3 flex flex-col items-end gap-1.5 z-10">
        <button
          onClick={handleButtonClick}
          disabled={status === "uploading"}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
            bg-black/50 backdrop-blur-sm border border-white/15 text-white/90
            hover:bg-black/70 hover:border-white/25 active:scale-95
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-all duration-150 shadow-lg"
        >
          {status === "uploading" ? (
            <>
              {/* Spinner */}
              <svg
                className="w-3 h-3 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v8H4z"
                />
              </svg>
              Uploading…
            </>
          ) : (
            <>
              {/* Camera / image icon */}
              <svg
                className="w-3 h-3"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586l-.707-.707A2 2 0 0012.586 4H7.414a2 2 0 00-1.414.586L5.293 5H4zm6 9a3 3 0 100-6 3 3 0 000 6z"
                  clipRule="evenodd"
                />
              </svg>
              Update Banner
            </>
          )}
        </button>

        {/* Status feedback */}
        {status === "success" && (
          <span className="text-[10px] font-semibold text-emerald-400 bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded-md">
            Banner updated ✓
          </span>
        )}
        {status === "error" && (
          <span className="text-[10px] font-semibold text-red-400 bg-black/70 backdrop-blur-sm px-2 py-1 rounded-md max-w-[200px] text-right leading-snug">
            {errorMsg}
          </span>
        )}
      </div>
    </>
  );
}
