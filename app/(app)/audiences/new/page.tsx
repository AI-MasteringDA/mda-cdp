"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { FilterBuilder } from "@/components/segments/FilterBuilder";
import type { FilterGroup } from "@/lib/segments/types";
import { ArrowLeft, Save } from "lucide-react";
import Link from "next/link";

export default function NewAudiencePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [filters, setFilters] = useState<FilterGroup>({
    logic: "AND",
    rules: [{ field: "score", op: "gte", value: 70 }],
  });
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preview count with debounce
  useEffect(() => {
    if (!filters.rules.length) { setPreviewCount(0); return; }
    setPreviewLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/audiences/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filters }),
        });
        const data = await res.json();
        setPreviewCount(data.count ?? 0);
      } catch {
        setPreviewCount(null);
      } finally {
        setPreviewLoading(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [filters]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) { setError("Thiếu tên audience"); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/audiences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, filters }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Lưu thất bại");
        setSaving(false);
        return;
      }
      router.push(`/audiences/${data.segment.segment_id}`);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }, [name, description, filters, router]);

  return (
    <>
      <Topbar title="Tạo audience" />
      <main className="mx-auto max-w-[900px] px-8 py-8">
        <Link href="/audiences" className="press inline-flex items-center gap-1 text-[12px] text-muted hover:text-foreground mb-4">
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} /> Quay lại
        </Link>

        <h1 className="text-[28px] font-semibold tracking-tight mb-1">Tạo audience mới</h1>
        <p className="text-[14px] text-muted mb-6">Kết hợp filter rules để tạo nhóm lead — preview count real-time.</p>

        {/* Name + description */}
        <div className="hairline rounded-2xl bg-white p-4 mb-4 space-y-3">
          <div>
            <label className="block text-[12px] font-medium text-muted-2 mb-1">Tên audience *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VD: SMAX hot chat 7 ngày, chưa form"
              className="press w-full h-9 rounded-md border border-[var(--border-subtle)] bg-white px-3 text-[13px] focus:border-foreground outline-none"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-muted-2 mb-1">Mô tả (tuỳ chọn)</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Dùng cho campaign nào?"
              className="press w-full h-9 rounded-md border border-[var(--border-subtle)] bg-white px-3 text-[13px] focus:border-foreground outline-none"
            />
          </div>
        </div>

        {/* Filter builder */}
        <div className="mb-4">
          <div className="mb-2 text-[12px] font-medium text-muted-2">Filter rules</div>
          <FilterBuilder initial={filters} onChange={setFilters} />
        </div>

        {/* Preview + save */}
        <div className="hairline rounded-2xl bg-white p-4 flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-2">Preview</div>
            <div className="mt-0.5 text-[22px] font-semibold tabular-nums">
              {previewLoading ? "…" : previewCount === null ? "—" : previewCount.toLocaleString("vi-VN")}
              <span className="ml-1 text-[13px] font-normal text-muted">leads khớp</span>
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="press inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-[13px] font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" strokeWidth={2} /> {saving ? "Đang lưu…" : "Lưu audience"}
          </button>
        </div>

        {error && <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</div>}
      </main>
    </>
  );
}
