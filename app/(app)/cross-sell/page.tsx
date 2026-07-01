import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { getCrossSellReady, getCrossSellStats } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

const STAGE_LABEL: Record<string, string> = {
  graduated: "🎓 Đã tốt nghiệp",
  dormant_customer: "💤 Ngủ đông",
  active_learner: "📚 Đang học",
  onboarding: "🌱 Vừa mua",
  churned: "❄️ Đã churn",
  prospect: "👋 Chưa mua",
};

const STAGE_STYLE: Record<string, string> = {
  graduated: "bg-emerald-50 text-emerald-700 border-emerald-200",
  dormant_customer: "bg-amber-50 text-amber-700 border-amber-200",
  active_learner: "bg-blue-50 text-blue-700 border-blue-200",
  onboarding: "bg-purple-50 text-purple-700 border-purple-200",
  churned: "bg-gray-50 text-gray-600 border-gray-200",
};

function formatVND(n: number) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return n.toLocaleString("vi-VN");
}

export default async function CrossSellPage({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string; stage?: string }>;
}) {
  const params = await searchParams;
  const tier = params.tier || "ready";
  const stageFilter = params.stage;

  const minScore = tier === "ready" ? 60 : tier === "nurture" ? 40 : 0;
  const [rows, stats] = await Promise.all([
    getCrossSellReady(minScore, 200),
    getCrossSellStats(),
  ]);

  const filteredRows = stageFilter
    ? rows.filter((r) => r.customer_lifecycle_stage === stageFilter)
    : rows;

  return (
    <>
      <Topbar title="Cross-sell READY" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6">
          <h1 className="text-[28px] font-semibold tracking-tight">
            💎 Cross-sell Engine — mở rộng doanh thu từ khách cũ
          </h1>
          <p className="mt-1 text-[14px] text-muted">
            Customers đã tốt nghiệp hoặc ngủ đông (6-24 tháng) với intent buy khoá mới. Ưu tiên upsell/cross-sell.
          </p>
        </div>

        {/* Stats cards */}
        <div className="mb-6 grid grid-cols-3 gap-4">
          <Link
            href="/cross-sell?tier=ready"
            className={`hairline rounded-2xl bg-white p-4 press ${tier === "ready" ? "ring-2 ring-emerald-400" : ""}`}
          >
            <div className="text-[11px] uppercase tracking-wide text-muted-2">💎 READY (60+)</div>
            <div className="mt-1 text-[28px] font-semibold">{stats.ready.toLocaleString("vi-VN")}</div>
            <div className="text-[12px] text-muted">Prime cross-sell target</div>
          </Link>
          <Link
            href="/cross-sell?tier=nurture"
            className={`hairline rounded-2xl bg-white p-4 press ${tier === "nurture" ? "ring-2 ring-amber-400" : ""}`}
          >
            <div className="text-[11px] uppercase tracking-wide text-muted-2">☀️ NURTURE (40-59)</div>
            <div className="mt-1 text-[28px] font-semibold">{stats.nurture.toLocaleString("vi-VN")}</div>
            <div className="text-[12px] text-muted">Email drip re-engage</div>
          </Link>
          <Link
            href="/cross-sell?tier=cold"
            className={`hairline rounded-2xl bg-white p-4 press ${tier === "cold" ? "ring-2 ring-slate-400" : ""}`}
          >
            <div className="text-[11px] uppercase tracking-wide text-muted-2">❄️ COLD (&lt;40)</div>
            <div className="mt-1 text-[28px] font-semibold">{stats.cold.toLocaleString("vi-VN")}</div>
            <div className="text-[12px] text-muted">Low priority</div>
          </Link>
        </div>

        {/* Stage filter chips */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-muted">Lifecycle:</span>
          <Link
            href={`/cross-sell?tier=${tier}`}
            className={`rounded-lg border px-2.5 py-1 text-[12px] press ${!stageFilter ? "bg-black text-white border-black" : "bg-white border-[var(--border-subtle)]"}`}
          >
            Tất cả
          </Link>
          {["graduated", "dormant_customer"].map((stg) => (
            <Link
              key={stg}
              href={`/cross-sell?tier=${tier}&stage=${stg}`}
              className={`rounded-lg border px-2.5 py-1 text-[12px] press ${stageFilter === stg ? "bg-black text-white border-black" : "bg-white border-[var(--border-subtle)]"}`}
            >
              {STAGE_LABEL[stg]}
            </Link>
          ))}
        </div>

        {/* Rows */}
        <div className="hairline rounded-2xl bg-white">
          {filteredRows.length === 0 ? (
            <div className="px-6 py-12 text-center text-[13px] text-muted-2">
              Không có customer nào khớp filter.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {filteredRows.map((row) => (
                <li key={row.lead_id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/lead/${row.lead_id}`} className="text-[15px] font-medium hover:underline truncate">
                          {row.full_name || row.email || "—"}
                        </Link>
                        <span className={`rounded-md border px-1.5 py-0.5 text-[11px] ${STAGE_STYLE[row.customer_lifecycle_stage] || "bg-gray-50 text-gray-600 border-gray-200"}`}>
                          {STAGE_LABEL[row.customer_lifecycle_stage] || row.customer_lifecycle_stage}
                        </span>
                        {row.months_since_last_purchase != null && (
                          <span className="text-[11px] text-muted-2">
                            {row.months_since_last_purchase}m ago
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-[12px] text-muted truncate">{row.email}</div>
                      {row.courses_purchased && row.courses_purchased.length > 0 && (
                        <div className="mt-1 text-[12px]">
                          <span className="text-muted-2">Đã mua: </span>
                          <span className="text-muted">{row.courses_purchased.join(", ")}</span>
                        </div>
                      )}
                      {row.suggested_next_course && (
                        <div className="mt-2 text-[12.5px]">
                          <span className="inline-block rounded-md bg-violet-50 border border-violet-200 px-2 py-1 text-violet-700">
                            ✨ Đề xuất khoá tiếp: <strong>{row.suggested_next_course}</strong>
                          </span>
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {row.cross_reasons.slice(0, 5).map((r, i) => (
                          <span
                            key={i}
                            className={`text-[11px] rounded-md border px-1.5 py-0.5 ${r.sign === "+" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-700 border-rose-200"}`}
                          >
                            {r.sign}
                            {r.points} {r.label}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <div className={`rounded-lg px-3 py-1.5 text-[16px] font-semibold ${row.cross_score >= 70 ? "bg-emerald-100 text-emerald-800" : row.cross_score >= 60 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                        {row.cross_score}
                      </div>
                      <div className="text-[11px] text-muted-2">
                        LTV {formatVND(row.lifetime_value)}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 text-[12px] text-muted-2">
          {filteredRows.length} customers · sorted by cross-sell score
        </div>
      </main>
    </>
  );
}
