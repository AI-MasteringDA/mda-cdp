"use client";

import { useState } from "react";
import { Info, X } from "lucide-react";
import type { MetricDefinition } from "@/lib/metrics-config";

/**
 * Click "i" icon next to a metric → popover shows the canonical definition.
 * Use beside KPI values to make "what does this number mean?" instantly answerable.
 */
export function MetricDefinitionBadge({ def }: { def: MetricDefinition }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center">
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title={`Định nghĩa: ${def.label}`}
        className="press inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-subtle text-muted-2 hover:text-foreground"
      >
        <Info className="h-3 w-3" strokeWidth={1.75} />
      </button>
      {open && (
        <>
          {/* Backdrop to close on outside click */}
          <button
            className="fixed inset-0 z-40 cursor-default"
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
          />
          <div
            className="absolute left-0 top-full z-50 mt-1.5 w-[320px] hairline rounded-xl bg-white p-3 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="text-[12px] font-semibold tracking-tight">{def.label}</div>
              <button onClick={() => setOpen(false)} className="text-muted-2 hover:text-foreground">
                <X className="h-3 w-3" strokeWidth={1.75} />
              </button>
            </div>
            <p className="text-[11px] text-muted leading-relaxed">{def.description}</p>
            <div className="mt-2 rounded bg-subtle p-2">
              <div className="text-[9px] uppercase tracking-wider text-muted-2 font-semibold mb-0.5">
                Quy tắc
              </div>
              <code className="text-[11px] font-mono text-foreground break-all leading-snug">
                {def.rule}
              </code>
            </div>
            {def.formula && (
              <div className="mt-2 rounded bg-subtle p-2">
                <div className="text-[9px] uppercase tracking-wider text-muted-2 font-semibold mb-0.5">
                  Công thức
                </div>
                <code className="text-[11px] font-mono text-foreground break-all leading-snug">
                  {def.formula}
                </code>
              </div>
            )}
            {def.caveat && (
              <div className="mt-2 rounded bg-[#fef9c3] p-2">
                <div className="text-[9px] uppercase tracking-wider text-[#854d0e] font-semibold mb-0.5">
                  ⚠️ Caveat
                </div>
                <p className="text-[11px] text-[#854d0e] leading-relaxed">{def.caveat}</p>
              </div>
            )}
          </div>
        </>
      )}
    </span>
  );
}
