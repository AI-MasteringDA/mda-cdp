"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Filter, X, Download, ArrowUpDown } from "lucide-react";
import type { Lead } from "@/types/lead";

const SOURCE_OPTIONS = [
  { value: "", label: "Tất cả nguồn" },
  { value: "salesforce", label: "Salesforce" },
  { value: "smax", label: "SMAX" },
  { value: "instantly", label: "Instantly" },
  { value: "web", label: "Wix" },
];

type StageOption = { value: string; label: string; count?: number };

const DEFAULT_STAGE_OPTIONS: StageOption[] = [
  { value: "", label: "Tất cả stage" },
];

const SORT_OPTIONS = [
  { value: "score-desc", label: "Score: Cao → Thấp" },
  { value: "score-asc",  label: "Score: Thấp → Cao" },
  { value: "recent",     label: "Hoạt động gần nhất" },
  { value: "oldest",     label: "Cũ nhất" },
  { value: "name",       label: "Tên A → Z" },
];

// Fallback nếu k truyền products từ server
const DEFAULT_PRODUCT_OPTIONS = [
  { value: "", label: "Tất cả khóa" },
];

const DEFAULT_LIST_VIEW_OPTIONS = [
  { value: "", label: "Tất cả SF list views" },
];

export function LeadListToolbar({
  leads,
  total,
  source,
  exportFilename,
  availableStages,
  availableProducts,
  activeCourses,
  availableListViews,
}: {
  leads: Lead[];
  total: number;
  source?: string;
  exportFilename?: string;
  availableStages?: StageOption[];
  /** Products auto-discovered from data (with hot counts). Sorted DESC by count. */
  availableProducts?: { product: string; hotCount: number }[];
  /** Substrings identifying currently-open courses. Matches will be highlighted 🔥. */
  activeCourses?: string[];
  /** SF List Views mirrored from Salesforce (viewId + name + hot count). */
  availableListViews?: { viewId: string; viewName: string; hotCount: number }[];
}) {
  const STAGE_OPTIONS = [
    ...DEFAULT_STAGE_OPTIONS,
    ...(availableStages ?? []).map((s) => ({
      value: s.value,
      label: s.count !== undefined ? `${s.label} (${s.count.toLocaleString("vi-VN")})` : s.label,
    })),
  ];

  const PRODUCT_OPTIONS = [
    ...DEFAULT_PRODUCT_OPTIONS,
    ...(availableProducts ?? []).map((p) => {
      const isActive = (activeCourses ?? []).some((k) =>
        p.product.toLowerCase().includes(k.trim().toLowerCase())
      );
      const prefix = isActive ? "🔥" : "📚";
      const activeSuffix = isActive ? " — đang mở" : "";
      return {
        value: p.product,
        label: `${prefix} ${p.product}${activeSuffix} (${p.hotCount} hot)`,
      };
    }),
  ];

  const LIST_VIEW_OPTIONS = [
    ...DEFAULT_LIST_VIEW_OPTIONS,
    ...(availableListViews ?? []).map((v) => ({
      value: v.viewId,
      label: `📋 ${v.viewName} (${v.hotCount} hot)`,
    })),
  ];

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const filterSource = searchParams.get("src") || "";
  const filterStage = searchParams.get("stage") || "";
  const filterProduct = searchParams.get("product") || "";
  const filterListView = searchParams.get("listView") || "";
  const sort = searchParams.get("sort") || "score-desc";

  const [downloading, setDownloading] = useState(false);

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page");
    startTransition(() => {
      router.push(`${pathname}${params.toString() ? "?" + params.toString() : ""}`, { scroll: false });
    });
  }

  function clearFilters() {
    const params = new URLSearchParams();
    const q = searchParams.get("q");
    if (q) params.set("q", q);
    startTransition(() => {
      router.push(`${pathname}${params.toString() ? "?" + params.toString() : ""}`, { scroll: false });
    });
  }

  function exportCsv() {
    setDownloading(true);
    try {
      // Use the leads array as-is (already filtered + sorted by URL params on server)
      const filename = exportFilename || `leads-${new Date().toISOString().slice(0, 10)}.csv`;
      const header = ["ID", "Name", "Email", "Phone", "Source", "Stage", "Score", "Tier", "Last Contact", "Assignee"];
      const rows = leads.map((l) => [
        l.id,
        l.name,
        l.email || "",
        l.phone || "",
        l.source,
        l.stage,
        String(l.score),
        l.tier,
        l.lastContactAt.toISOString().slice(0, 19),
        l.assignee || "",
      ]);
      const csv = [header, ...rows]
        .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
        .join("\n");
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  const hasFilters = filterSource || filterStage || filterProduct || filterListView || (sort && sort !== "score-desc");

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <Filter className="h-3.5 w-3.5 text-muted-2" strokeWidth={1.75} />
        <span className="text-muted-2">Lọc:</span>

        {!source && (
          <select
            value={filterSource}
            onChange={(e) => updateParam("src", e.target.value)}
            className="press h-8 rounded-md border border-[var(--border-subtle)] bg-white px-2 text-[12px] focus:border-foreground outline-none"
          >
            {SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        )}

        <select
          value={filterStage}
          onChange={(e) => updateParam("stage", e.target.value)}
          className="press h-8 rounded-md border border-[var(--border-subtle)] bg-white px-2 text-[12px] focus:border-foreground outline-none"
        >
          {STAGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          value={filterProduct}
          onChange={(e) => updateParam("product", e.target.value)}
          className="press h-8 rounded-md border border-[var(--border-subtle)] bg-white px-2 text-[12px] focus:border-foreground outline-none"
          title="Filter theo khóa học đang mở"
        >
          {PRODUCT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {LIST_VIEW_OPTIONS.length > 1 && (
          <select
            value={filterListView}
            onChange={(e) => updateParam("listView", e.target.value)}
            className="press h-8 rounded-md border border-[var(--border-subtle)] bg-white px-2 text-[12px] focus:border-foreground outline-none"
            title="SF List Views (auto-sync mỗi giờ)"
          >
            {LIST_VIEW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        )}

        <span className="text-muted-2 ml-2">Sắp xếp:</span>
        <select
          value={sort}
          onChange={(e) => updateParam("sort", e.target.value)}
          className="press h-8 rounded-md border border-[var(--border-subtle)] bg-white px-2 text-[12px] focus:border-foreground outline-none"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {hasFilters && (
          <button
            onClick={clearFilters}
            className="press inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted hover:text-foreground hover:bg-subtle"
          >
            <X className="h-3 w-3" strokeWidth={1.75} />
            Xoá
          </button>
        )}

        <span className="ml-2 text-muted-2">
          <ArrowUpDown className="inline h-3 w-3 mr-1" strokeWidth={1.75} />
          {leads.length} hiển thị / {total} tổng
        </span>
      </div>

      <button
        onClick={exportCsv}
        disabled={downloading || leads.length === 0}
        className="press ml-auto inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-white px-3 py-1.5 text-[12px] hover:bg-subtle disabled:opacity-50"
        title="Export trang hiện tại ra CSV"
      >
        <Download className={`h-3.5 w-3.5 ${downloading ? "animate-pulse" : ""}`} strokeWidth={1.75} />
        Export CSV
      </button>
    </div>
  );
}
