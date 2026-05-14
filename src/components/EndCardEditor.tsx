"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

interface Props {
  currentEndCardUrl: string;
}

export default function EndCardEditor({ currentEndCardUrl }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setStatus("uploading");
    setErrorMsg("");

    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/end-card", { method: "POST", body: form });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStatus("success");
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Upload failed.");
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-4">
        {/* Current preview */}
        <div className="relative w-14 shrink-0 rounded-xl overflow-hidden border border-neutral-700 shadow">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentEndCardUrl}
            alt="Current end card"
            className="w-full h-auto object-contain bg-black"
          />
        </div>

        <div className="flex flex-col gap-2 min-w-0 flex-1">
          <div>
            <p className="text-sm font-semibold text-white">Official End Card Asset</p>
            <p className="text-xs text-neutral-500 mt-0.5">
              Automatically appended to every generated reel via{" "}
              <code className="text-neutral-400 bg-neutral-800 px-1 py-0.5 rounded text-[10px]">
                reference_image_urls
              </code>
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={status === "uploading"}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-700 bg-neutral-900 text-xs text-neutral-300 hover:bg-neutral-800 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === "uploading" ? (
                <><span className="w-3 h-3 border border-neutral-600 border-t-white rounded-full animate-spin inline-block" /> Uploading…</>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                  Replace End Card
                </>
              )}
            </button>

            {status === "success" && (
              <span className="text-xs font-medium text-emerald-400">Official end card updated.</span>
            )}
            {status === "error" && errorMsg && (
              <span className="text-xs text-red-400">{errorMsg}</span>
            )}
          </div>
        </div>
      </div>

      <p className="text-xs text-neutral-600">
        Upload a new 9:16 image (JPEG, PNG, or WebP, max 10 MB). The existing end card remains
        active until a replacement is saved.
      </p>
    </div>
  );
}
