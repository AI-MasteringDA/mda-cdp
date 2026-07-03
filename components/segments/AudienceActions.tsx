"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, RefreshCw } from "lucide-react";

export function AudienceActions({ segmentId, name }: { segmentId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"delete" | "recompute" | null>(null);

  const handleDelete = async () => {
    if (!confirm(`Xoá audience "${name}"? Không undo được.`)) return;
    setBusy("delete");
    const res = await fetch(`/api/audiences/${segmentId}`, { method: "DELETE" });
    if (res.ok) router.push("/audiences");
    else setBusy(null);
  };

  const handleRecompute = async () => {
    setBusy("recompute");
    // Reload current members by re-patching with same filters (empty patch triggers no-op)
    // Actually just trigger a full refresh with cur filters
    const seg = await fetch(`/api/audiences/${segmentId}`).then((r) => r.json());
    if (seg?.segment?.filters) {
      await fetch(`/api/audiences/${segmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: seg.segment.filters }),
      });
    }
    router.refresh();
    setBusy(null);
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleRecompute}
        disabled={busy !== null}
        className="press inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-white px-3 py-1.5 text-[12px] hover:bg-subtle disabled:opacity-50"
        title="Re-evaluate filter và cập nhật members"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${busy === "recompute" ? "animate-spin" : ""}`} strokeWidth={1.75} />
        Recompute
      </button>
      <button
        onClick={handleDelete}
        disabled={busy !== null}
        className="press inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-[12px] text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        Xoá
      </button>
    </div>
  );
}
