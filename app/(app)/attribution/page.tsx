import { Topbar } from "@/components/Topbar";
import { KPICard } from "@/components/KPICard";
import { SimpleBar } from "@/components/charts/SimpleBar";
import {
  getConversionBySource,
  getSourceDistribution,
  getSmaxChannelBreakdown,
  getTopLeadSources,
  getAllLeadsCount,
} from "@/lib/supabase/queries";
import { AlertTriangle, TrendingUp, Trophy } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AttributionPage() {
  const [bySource, sourceDist, smaxChannels, topLeadSources, totalLeads] = await Promise.all([
    getConversionBySource(),
    getSourceDistribution(),
    getSmaxChannelBreakdown(),
    getTopLeadSources(12),
    getAllLeadsCount(),
  ]);

  const totalConverted = bySource.reduce((s, x) => s + x.converted, 0);
  const totalSourceLeads = bySource.reduce((s, x) => s + x.total, 0);
  const overallRate = totalSourceLeads ? (totalConverted / totalSourceLeads * 100) : 0;

  const best = [...bySource].filter((s) => s.total >= 5).sort((a, b) => b.rate - a.rate)[0];
  const worst = [...bySource].filter((s) => s.total >= 5).sort((a, b) => a.rate - b.rate)[0];

  // Lead volume bar
  const leadVolumeBar = sourceDist
    .map((s) => ({ label: s.name, value: s.leads, color: s.color }))
    .sort((a, b) => b.value - a.value);

  // Conversion rate bar
  const convRateBar = bySource
    .map((s) => ({
      label: SOURCE_LABEL[s.source] || s.source,
      value: Number(s.rate.toFixed(2)),
      color: s.color,
    }))
    .sort((a, b) => b.value - a.value);

  // SMAX channels bar
  const smaxBar = smaxChannels.slice(0, 10).map((c) => ({
    label: c.label,
    value: c.uniqueLeads,
    color: c.color,
  }));

  // Top lead_source palette
  const palette = ["#1877f2", "#f59e0b", "#7c3aed", "#10b981", "#ff3b30", "#06b6d4", "#84cc16", "#ec4899", "#0ea5e9", "#a855f7", "#22c55e", "#eab308"];
  const leadSourceBar = topLeadSources.map((s, i) => ({
    label: s.label,
    value: s.count,
    color: palette[i % palette.length],
  }));

  return (
    <>
      <Topbar title="Attribution" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6">
          <h1 className="text-[28px] font-semibold tracking-tight">
            Kênh nào ra học viên thật?
          </h1>
          <p className="mt-1 text-[14px] text-muted">
            Phân bổ lead theo nguồn data + tỷ lệ chốt từng nguồn. Lưu ý: chưa có ad spend → chỉ tính được conversion rate, chưa tính CAC.
          </p>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <KPICard label="Tổng lead" value={totalLeads.toLocaleString("vi-VN")} />
          <KPICard label="Đã chốt" value={totalConverted.toLocaleString("vi-VN")} />
          <KPICard label="Conversion rate trung bình" value={`${overallRate.toFixed(2)}%`} />
          <KPICard label="Số nguồn data" value={sourceDist.filter((s) => s.leads > 0).length} />
        </div>

        {/* Winner / Loser banner */}
        {best && worst && best.source !== worst.source && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="hairline rounded-2xl bg-[#f0fdf4] p-5">
              <div className="flex items-start gap-3">
                <Trophy className="mt-0.5 h-5 w-5 text-[var(--success)]" strokeWidth={1.75} />
                <div>
                  <h3 className="text-[14px] font-semibold">🏆 Kênh ngon nhất</h3>
                  <p className="mt-1 text-[13px] text-muted">
                    <strong>{SOURCE_LABEL[best.source] || best.source}</strong>: {best.converted}/{best.total} lead chốt
                    {" "}<span className="font-mono">({best.rate}%)</span>
                  </p>
                </div>
              </div>
            </div>
            <div className="hairline rounded-2xl bg-[#fef2f2] p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-[var(--hot)]" strokeWidth={1.75} />
                <div>
                  <h3 className="text-[14px] font-semibold">⚠️ Kênh đang yếu</h3>
                  <p className="mt-1 text-[13px] text-muted">
                    <strong>{SOURCE_LABEL[worst.source] || worst.source}</strong>: {worst.converted}/{worst.total} lead chốt
                    {" "}<span className="font-mono">({worst.rate}%)</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Source: Conversion rate */}
        <section className="hairline rounded-2xl bg-white mb-6">
          <div className="hairline-b px-6 py-4">
            <h2 className="text-[15px] font-semibold tracking-tight">Tỷ lệ chốt theo nguồn (%)</h2>
            <p className="mt-0.5 text-[12px] text-muted">
              Conversion rate = lead có ít nhất 1 conversion event / tổng lead nguồn đó.
            </p>
          </div>
          <div className="p-6">
            {convRateBar.length === 0 ? (
              <EmptyChart />
            ) : (
              <SimpleBar data={convRateBar} valueLabel="%" />
            )}
          </div>
        </section>

        {/* Source: Lead volume */}
        <section className="hairline rounded-2xl bg-white mb-6">
          <div className="hairline-b px-6 py-4">
            <h2 className="text-[15px] font-semibold tracking-tight">Khối lượng lead theo nguồn</h2>
            <p className="mt-0.5 text-[12px] text-muted">
              Đếm distinct lead trong <code className="font-mono text-[11px] bg-subtle px-1 rounded">dim_lead</code>.
            </p>
          </div>
          <div className="p-6">
            {leadVolumeBar.length === 0 ? (
              <EmptyChart />
            ) : (
              <SimpleBar data={leadVolumeBar} valueLabel="lead" />
            )}
          </div>
        </section>

        {/* SMAX channel breakdown */}
        {smaxBar.length > 0 && (
          <section className="hairline rounded-2xl bg-white mb-6">
            <div className="hairline-b px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight">SMAX — phân tách theo kênh chat</h2>
                <p className="mt-0.5 text-[12px] text-muted">
                  FB Brand vs FB KOL vs Zalo vs Website Live Chat — kênh nào sinh lead chat nhiều nhất.
                </p>
              </div>
              <TrendingUp className="h-5 w-5 text-muted-2" strokeWidth={1.75} />
            </div>
            <div className="p-6">
              <SimpleBar data={smaxBar} valueLabel="lead" />
            </div>
          </section>
        )}

        {/* Top lead_source */}
        {leadSourceBar.length > 0 && (
          <section className="hairline rounded-2xl bg-white">
            <div className="hairline-b px-6 py-4">
              <h2 className="text-[15px] font-semibold tracking-tight">Top campaigns / lead_source chi tiết</h2>
              <p className="mt-0.5 text-[12px] text-muted">
                Field <code className="font-mono text-[11px] bg-subtle px-1 rounded">lead_source</code> từ Salesforce
                — KOL nào, fanpage nào, ads campaign nào kéo lead về.
              </p>
            </div>
            <div className="p-6">
              <SimpleBar data={leadSourceBar} valueLabel="lead" />
            </div>
          </section>
        )}
      </main>
    </>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  salesforce: "Salesforce",
  smax: "SMAX",
  instantly: "Instantly",
  web: "Website",
};

function EmptyChart() {
  return (
    <div className="py-12 text-center text-[13px] text-muted-2">
      Chưa có dữ liệu — chạy ETL để có data.
    </div>
  );
}
