"use client";

import { useState, useTransition } from "react";
import { RefreshCw, CheckCircle2 } from "lucide-react";
import { recomputeScores } from "./actions";

export function RecomputeButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  function handleClick() {
    setResult(null);
    startTransition(async () => {
      const r = await recomputeScores();
      if (r?.error) setResult(`Lỗi: ${r.error}`);
      else setResult(`Đã tính lại ${r?.count ?? 0} lead`);
      setTimeout(() => setResult(null), 4000);
    });
  }

  return (
    <div className="flex items-center gap-3">
      {result && (
        <span className="flex items-center gap-1.5 text-[12px] text-[var(--success)]">
          <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
          {result}
        </span>
      )}
      <button
        onClick={handleClick}
        disabled={pending}
        className="flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-60"
      >
        <RefreshCw
          className={`h-4 w-4 ${pending ? "animate-spin" : ""}`}
          strokeWidth={1.75}
        />
        {pending ? "Đang tính..." : "Tính lại scores"}
      </button>
    </div>
  );
}
