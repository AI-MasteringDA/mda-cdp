"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Dashboard Error]", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-[680px] px-8 py-20">
      <div className="hairline rounded-2xl bg-white p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#fee2e2]">
          <AlertTriangle className="h-6 w-6 text-[#dc2626]" strokeWidth={1.75} />
        </div>
        <h2 className="mt-4 text-[18px] font-semibold tracking-tight">
          Không tải được dashboard
        </h2>
        <p className="mt-2 text-[13px] text-muted leading-relaxed">
          Có thể do 1 query DB chạy lâu hơn 60s (Vercel Hobby limit) hoặc lỗi runtime.
        </p>
        {error.message && (
          <div className="mt-4 rounded-lg bg-subtle p-3 text-left text-[11px] font-mono text-muted break-all">
            {error.message.slice(0, 300)}
          </div>
        )}
        <button
          onClick={reset}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-[13px] font-medium text-white hover:opacity-90"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
          Thử lại
        </button>
      </div>
    </main>
  );
}
