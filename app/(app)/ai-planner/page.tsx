import { Topbar } from "@/components/Topbar";
import { KPICard } from "@/components/KPICard";
import {
  getConversionBySource,
  getStaleLeadsCount,
  getTierDistribution,
  getTvvPerformance,
  getConversionFunnel,
  getStageDistribution,
  getAllLeadsCount,
} from "@/lib/supabase/queries";
import {
  Lightbulb,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Target,
  Zap,
  Users,
  Trophy,
} from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  salesforce: "Salesforce",
  smax: "SMAX",
  instantly: "Instantly",
  web: "Website",
};

type Insight = {
  priority: "P0" | "P1" | "P2";
  icon: React.ComponentType<{ className?: string; strokeWidth?: number; style?: React.CSSProperties }>;
  color: string;
  title: string;
  finding: string;
  evidence: string;
  action: string;
  ctaLabel?: string;
  ctaHref?: string;
};

function generateInsights(args: {
  bySource: Awaited<ReturnType<typeof getConversionBySource>>;
  tiers: Awaited<ReturnType<typeof getTierDistribution>>;
  tvv: Awaited<ReturnType<typeof getTvvPerformance>>;
  funnel: Awaited<ReturnType<typeof getConversionFunnel>>;
  stages: Awaited<ReturnType<typeof getStageDistribution>>;
  staleCnt: number;
  totalLeads: number;
}): Insight[] {
  const out: Insight[] = [];
  const { bySource, tiers, tvv, funnel, stages, staleCnt, totalLeads } = args;

  // 1) Best vs worst source (P0)
  const minLeadsForSignal = 5;
  const valid = bySource.filter((s) => s.total >= minLeadsForSignal);
  const best = [...valid].sort((a, b) => b.rate - a.rate)[0];
  const worst = [...valid].sort((a, b) => a.rate - b.rate)[0];
  if (best && worst && best.source !== worst.source && best.rate > worst.rate * 1.5) {
    out.push({
      priority: "P0",
      icon: Trophy,
      color: "var(--success)",
      title: `Đổ ngân sách vào ${SOURCE_LABEL[best.source] || best.source}`,
      finding: `${SOURCE_LABEL[best.source] || best.source} chuyển đổi gấp ${(best.rate / Math.max(worst.rate, 0.01)).toFixed(1)}× ${SOURCE_LABEL[worst.source] || worst.source}.`,
      evidence: `${SOURCE_LABEL[best.source] || best.source}: ${best.converted}/${best.total} = ${best.rate}%. ${SOURCE_LABEL[worst.source] || worst.source}: ${worst.converted}/${worst.total} = ${worst.rate}%.`,
      action: `Tăng spend cho ${SOURCE_LABEL[best.source] || best.source} +30%. Giảm hoặc audit lại ${SOURCE_LABEL[worst.source] || worst.source}.`,
      ctaLabel: "Xem Attribution",
      ctaHref: "/attribution",
    });
  }

  // 2) Stale lead alert (P0 if >20%)
  const stalePct = totalLeads ? (staleCnt / totalLeads * 100) : 0;
  if (stalePct > 15) {
    out.push({
      priority: stalePct > 30 ? "P0" : "P1",
      icon: AlertCircle,
      color: "var(--hot)",
      title: "Nuôi lead nguội — re-engagement campaign",
      finding: `${staleCnt.toLocaleString("vi-VN")} lead (${stalePct.toFixed(1)}%) không engage trong 30 ngày.`,
      evidence: `Tỷ lệ nguội cao = TVV bỏ rơi hoặc nội dung không thu hút đủ.`,
      action: "Chạy chiến dịch email re-engagement với hook mới (chia case study cũ, ưu đãi giới hạn).",
      ctaLabel: "Xem Lead NGỦ ĐÔNG",
      ctaHref: "/dormant-leads",
    });
  }

  // 3) Bottleneck stage (P1)
  let biggestDrop = { from: "", to: "", pct: 0, lost: 0 };
  for (let i = 1; i < funnel.length; i++) {
    const prev = funnel[i - 1];
    const curr = funnel[i];
    if (prev.count > 0) {
      const lost = prev.count - curr.count;
      const pct = lost / prev.count * 100;
      if (pct > biggestDrop.pct) {
        biggestDrop = { from: prev.stage, to: curr.stage, pct, lost };
      }
    }
  }
  if (biggestDrop.pct > 50) {
    out.push({
      priority: "P1",
      icon: TrendingDown,
      color: "var(--warm)",
      title: `Bottleneck: ${biggestDrop.from} → ${biggestDrop.to}`,
      finding: `${biggestDrop.pct.toFixed(1)}% drop ở bước này — mất ${biggestDrop.lost.toLocaleString("vi-VN")} lead.`,
      evidence: `Đây là điểm rơi lớn nhất trong funnel hiện tại.`,
      action: "A/B test message ở giai đoạn này. Có thể nội dung chưa khớp với intent của lead.",
      ctaLabel: "Xem Funnel chi tiết",
      ctaHref: "/funnel",
    });
  }

  // 4) Hot lead with low TVV ratio (P0)
  const hot = tiers.find((t) => t.name === "NÓNG")?.value ?? 0;
  if (hot > 0 && tvv.length > 0) {
    const avgPerTvv = hot / tvv.length;
    if (avgPerTvv > 20) {
      out.push({
        priority: "P0",
        icon: Zap,
        color: "var(--hot)",
        title: "Lead NÓNG đang dồn đống — cần phân TVV",
        finding: `Hiện ${hot.toLocaleString("vi-VN")} lead NÓNG / ${tvv.length} TVV = ${avgPerTvv.toFixed(0)} lead/người.`,
        evidence: `Mỗi TVV chỉ contact được ~5-10 lead/ngày — nhiều lead NÓNG đang vô chủ.`,
        action: "Thêm TVV trực hoặc auto-assign theo round-robin để không bỏ lỡ window NÓNG.",
        ctaLabel: "Xem Lead NÓNG",
        ctaHref: "/hot-leads",
      });
    }
  }

  // 5) TVV champion (P2)
  const topTvv = [...tvv].filter((t) => t.leadCount >= 10).sort((a, b) => b.conversionRate - a.conversionRate)[0];
  if (topTvv && topTvv.conversionRate > 0) {
    out.push({
      priority: "P2",
      icon: Trophy,
      color: "var(--success)",
      title: `Học từ ${topTvv.name}`,
      finding: `${topTvv.name} chuyển đổi ${topTvv.conversionRate.toFixed(1)}% — cao nhất nhóm.`,
      evidence: `${topTvv.converted}/${topTvv.leadCount} lead chốt. Có thể có script/cách tiếp cận khác biệt.`,
      action: "Phỏng vấn để rút playbook, training lại nhóm. Record cuộc gọi để team học.",
      ctaLabel: "Xem performance team",
      ctaHref: "/team",
    });
  }

  // 6) Stage stuck (P1)
  const consulting = stages.find((s) => s.stage === "Đang tư vấn")?.count ?? 0;
  const closed = stages.find((s) => s.stage === "Đã chốt")?.count ?? 0;
  if (consulting > closed * 3 && consulting > 20) {
    out.push({
      priority: "P1",
      icon: Target,
      color: "var(--accent)",
      title: "Pipeline tắc tại 'Đang tư vấn'",
      finding: `${consulting.toLocaleString("vi-VN")} lead đang tư vấn / ${closed.toLocaleString("vi-VN")} chốt = tỷ lệ thấp.`,
      evidence: "Nhiều lead bị TVV giữ quá lâu trong giai đoạn tư vấn mà không close.",
      action: "Setup auto-reminder cho TVV: lead 'Đang tư vấn' > 7 ngày phải có hành động close hoặc move stage.",
      ctaLabel: "Xem cảnh báo",
      ctaHref: "/alerts",
    });
  }

  return out.sort((a, b) => {
    const order = { P0: 0, P1: 1, P2: 2 };
    return order[a.priority] - order[b.priority];
  });
}

export default async function AIPlannerPage() {
  const [bySource, tiers, tvv, funnel, stages, staleCnt, totalLeads] = await Promise.all([
    getConversionBySource(),
    getTierDistribution(),
    getTvvPerformance(),
    getConversionFunnel(),
    getStageDistribution(),
    getStaleLeadsCount(30),
    getAllLeadsCount(),
  ]);

  const insights = generateInsights({ bySource, tiers, tvv, funnel, stages, staleCnt, totalLeads });
  const p0Count = insights.filter((i) => i.priority === "P0").length;
  const hot = tiers.find((t) => t.name === "NÓNG")?.value ?? 0;

  return (
    <>
      <Topbar title="AI Planner" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6 flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-yellow-400 to-orange-500">
            <Lightbulb className="h-6 w-6 text-white" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">
              Kế hoạch tăng trưởng — đề xuất tự động
            </h1>
            <p className="mt-1 text-[14px] text-muted">
              Heuristic engine đọc data thật từ DB, sinh khuyến nghị theo độ ưu tiên.
              Không phải Claude AI — chỉ là rules đơn giản nhưng tin được vì dựa trên số liệu.
            </p>
          </div>
        </div>

        {/* Snapshot KPI */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <KPICard label="Insights đề xuất" value={insights.length} />
          <KPICard label="P0 (ưu tiên cao)" value={p0Count} />
          <KPICard label="Lead NÓNG đang chờ" value={hot.toLocaleString("vi-VN")} />
          <KPICard label="Lead nguội 30d+" value={staleCnt.toLocaleString("vi-VN")} />
        </div>

        {/* Insights list */}
        {insights.length === 0 ? (
          <section className="hairline rounded-2xl bg-white p-12 text-center">
            <Lightbulb className="mx-auto h-10 w-10 text-muted-2" strokeWidth={1.5} />
            <h3 className="mt-3 text-[15px] font-semibold">Chưa có khuyến nghị nào</h3>
            <p className="mt-1 text-[13px] text-muted">
              Hệ thống cần nhiều data hơn (conversion, lead-source thực) để sinh insights có giá trị.
            </p>
          </section>
        ) : (
          <div className="space-y-4">
            {insights.map((ins, i) => {
              const Icon = ins.icon;
              return (
                <section key={i} className="hairline rounded-2xl bg-white overflow-hidden">
                  <div className="hairline-b px-6 py-4 flex items-center justify-between bg-subtle/30">
                    <div className="flex items-center gap-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          ins.priority === "P0"
                            ? "bg-[var(--hot)] text-white"
                            : ins.priority === "P1"
                            ? "bg-[var(--warm)] text-white"
                            : "bg-[var(--accent)] text-white"
                        }`}
                      >
                        {ins.priority}
                      </span>
                      <h3 className="text-[15px] font-semibold tracking-tight">{ins.title}</h3>
                    </div>
                    <Icon className="h-5 w-5" style={{ color: ins.color }} strokeWidth={1.75} />
                  </div>
                  <div className="p-6 space-y-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-2 font-semibold mb-1">
                        Phát hiện
                      </div>
                      <p className="text-[14px]">{ins.finding}</p>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-2 font-semibold mb-1">
                        Bằng chứng
                      </div>
                      <p className="text-[13px] text-muted">{ins.evidence}</p>
                    </div>
                    <div className="border-t border-[var(--border-subtle)] pt-3">
                      <div className="text-[10px] uppercase tracking-wider text-muted-2 font-semibold mb-1">
                        Đề xuất hành động
                      </div>
                      <p className="text-[14px] font-medium">{ins.action}</p>
                      {ins.ctaHref && (
                        <Link
                          href={ins.ctaHref}
                          className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--accent)] hover:underline"
                        >
                          {ins.ctaLabel} →
                        </Link>
                      )}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 hairline rounded-2xl bg-[#fef9c3] p-5">
          <div className="flex items-start gap-3">
            <Users className="mt-0.5 h-5 w-5 text-[var(--warm)]" strokeWidth={1.75} />
            <div>
              <h3 className="text-[14px] font-semibold">Người vẫn là người quyết</h3>
              <p className="mt-1 text-[13px] text-muted">
                AI Planner chỉ <strong>đề xuất</strong> dựa trên data. Quyết định cuối cùng (tăng spend, sa thải TVV, dừng kênh)
                cần con người + context mà data không thấy.
              </p>
              <p className="mt-2 text-[12px] text-muted-2">
                <TrendingUp className="inline h-3 w-3 mr-1" strokeWidth={1.75} />
                Sau này sẽ kết nối Claude API để có khả năng phân tích sâu hơn — đọc context bài viết, hiểu intent.
              </p>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
