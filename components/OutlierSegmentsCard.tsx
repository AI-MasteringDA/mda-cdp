"use client";

import { useState } from "react";
import { Trophy, TrendingUp, Download } from "lucide-react";
import { useToast } from "@/components/Toast";

type Segment = {
  source: string;
  engagement_label: string;
  engagement_min: number;
  engagement_max: number | null;
  leads: number;
  students: number;
  conversion_rate_pct: number;
  lift: number;
};

type Data = {
  baseline_conversion_rate_pct: number;
  total_leads: number;
  total_students: number;
  segments: Segment[];
};

const SOURCE_LABEL: Record<string, string> = {
  salesforce: "Salesforce",
  smax: "SMAX",
  instantly: "Instantly",
  web: "Wix Website",
};

function liftColor(lift: number): string {
  if (lift >= 3) return "#15803d"; // strong outlier — dark green
  if (lift >= 2) return "#34c759"; // outlier — green
  if (lift >= 1.5) return "#0064d0"; // above baseline — blue
  if (lift >= 0.8) return "#8e8e93"; // around baseline — gray
  return "#dc2626"; // below baseline — red
}

function liftBg(lift: number): string {
  if (lift >= 3) return "#dcfce7";
  if (lift >= 2) return "#f0fdf4";
  if (lift >= 1.5) return "#eff6ff";
  if (lift >= 0.8) return "#f4f4f5";
  return "#fef2f2";
}

export function OutlierSegmentsCard({ data }: { data: Data }) {
  const [downloading, setDownloading] = useState<string | null>(null);
  const toast = useToast();

  async function exportLookalike(seg: Segment) {
    setDownloading(`${seg.source}-${seg.engagement_label}`);
    try {
      const params = new URLSearchParams({
        source: seg.source,
        min: String(seg.engagement_min),
        ...(seg.engagement_max !== null ? { max: String(seg.engagement_max) } : {}),
        converted_only: "true",
      });
      const res = await fetch(`/api/segments/lookalike-export?${params}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safe = `${seg.source}-${seg.engagement_label.replace(/[^a-zA-Z0-9]/g, "_")}`;
      a.download = `lookalike-${safe}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Đã download", `Tệp lookalike: ${seg.students} học viên`);
    } catch (e) {
      toast.error("Export lỗi", (e as Error).message);
    } finally {
      setDownloading(null);
    }
  }

  const outliers = data.segments.filter((s) => s.lift >= 1.5);

  return (
    <section className="hairline rounded-2xl bg-white">
      <div className="hairline-b px-6 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight flex items-center gap-2">
            <Trophy className="h-4 w-4 text-[#34c759]" strokeWidth={1.75} />
            Phân khúc giá trị cao (outliers)
          </h2>
          <p className="mt-0.5 text-[12px] text-muted">
            Baseline conversion rate toàn DB:
            <strong className="ml-1 text-foreground tabular-nums">{data.baseline_conversion_rate_pct.toFixed(2)}%</strong>
            {" "}({data.total_students.toLocaleString("vi-VN")} / {data.total_leads.toLocaleString("vi-VN")} lead).
            Lift &gt;= 1.5x = nhóm chốt tốt bất thường → export làm lookalike.
          </p>
        </div>
        <TrendingUp className="h-5 w-5 text-muted-2" strokeWidth={1.75} />
      </div>

      <div className="p-3 overflow-x-auto">
        {data.segments.length === 0 ? (
          <div className="py-12 text-center text-[13px] text-muted-2">
            Chưa đủ data — cần ≥ 5 leads/segment để có ý nghĩa thống kê.
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-muted-2 font-medium">
                <th className="text-left px-4 py-2">Nguồn</th>
                <th className="text-left px-4 py-2">Engagement</th>
                <th className="text-right px-4 py-2">Leads</th>
                <th className="text-right px-4 py-2">Chốt</th>
                <th className="text-right px-4 py-2">Conv %</th>
                <th className="text-right px-4 py-2">Lift vs baseline</th>
                <th className="text-right px-4 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.segments.map((seg) => (
                <tr
                  key={`${seg.source}-${seg.engagement_label}`}
                  className="border-t border-[var(--border-subtle)] hover:bg-subtle"
                >
                  <td className="px-4 py-2.5 font-medium">{SOURCE_LABEL[seg.source] || seg.source}</td>
                  <td className="px-4 py-2.5 text-muted">{seg.engagement_label}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{seg.leads.toLocaleString("vi-VN")}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                    {seg.students.toLocaleString("vi-VN")}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{seg.conversion_rate_pct.toFixed(2)}%</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <span
                      className="inline-flex items-center justify-center rounded-md px-2 py-0.5 text-[12px] font-bold"
                      style={{ background: liftBg(seg.lift), color: liftColor(seg.lift) }}
                    >
                      {seg.lift}x
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {seg.lift >= 1.5 && seg.students >= 3 ? (
                      <button
                        onClick={() => exportLookalike(seg)}
                        disabled={downloading === `${seg.source}-${seg.engagement_label}`}
                        className="press inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-white px-2 py-1 text-[11px] hover:bg-subtle disabled:opacity-50"
                        title="Download CSV để build lookalike trên Google/FB/TikTok Ads"
                      >
                        <Download className="h-3 w-3" strokeWidth={1.75} />
                        Lookalike
                      </button>
                    ) : (
                      <span className="text-[10px] text-muted-2">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {outliers.length > 0 && (
        <div className="hairline-t px-6 py-3 bg-[#f0fdf4]">
          <p className="text-[12px] text-[#15803d] leading-relaxed">
            🎯 <strong>{outliers.length} phân khúc có lift ≥ 1.5x</strong> — đó là những combo
            "Source × Engagement bucket" chốt tốt hơn average. Export làm lookalike → đẩy lên ads platform
            để tìm thêm người giống vậy.
          </p>
        </div>
      )}
    </section>
  );
}
