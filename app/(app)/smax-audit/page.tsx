import { KPICard } from "@/components/KPICard";
import { SimpleBar } from "@/components/charts/SimpleBar";
import { getAuditData, summarize } from "@/lib/smax-audit";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function SmaxAuditOverview() {
  const data = await getAuditData(14);
  const s = summarize(data);
  const maxDay = Math.max(...s.days.map(([, v]) => v), 1);

  return (
    <main className="mx-auto max-w-[1280px] px-8 py-8">
      <div className="mb-6">
        <h1 className="text-[28px] font-semibold tracking-tight">SMAX Audit — 14 ngày</h1>
        <p className="mt-1 text-[14px] text-muted">
          Theo dõi lỗ hổng chăm sóc lead: chưa rep, chưa xin info, thiếu tag, cần follow-up.
          Dữ liệu SMAX sync mỗi 15 phút{data.larkOk ? "" : " · ⚠️ thiếu LARK_* env — cột AI đang ẩn"}.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 mb-8">
        <KPICard label="Leads hoạt động" value={s.total} unit="leads" accent="cool" deltaLabel="trong 14 ngày" />
        <KPICard label="Chưa phản hồi" value={s.unreplied} unit="khách chờ" accent="hot" deltaLabel="tin cuối là của khách" />
        <KPICard
          label="Chưa xin info"
          value={s.chuaXinInfo ?? "—"}
          unit={s.chuaXinInfo != null ? "leads" : ""}
          accent="warm"
          deltaLabel="AI đọc hội thoại xác nhận"
        />
        <KPICard
          label="Đã có contact"
          value={s.total ? Math.round((s.hasContact / s.total) * 100) : 0}
          unit="%"
          accent="success"
          deltaLabel={`${s.hasContact}/${s.total} leads có SĐT/email`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="bezel">
          <div className="bezel-inner p-6">
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="text-[15px] font-semibold">Leads hoạt động theo ngày</h2>
              <span className="text-[12px] text-muted">giờ VN</span>
            </div>
            <p className="mb-5 text-[12.5px] text-muted">Số khách có tin nhắn mỗi ngày trong cửa sổ 14 ngày</p>
            <div className="flex items-end gap-[3px] h-[180px] border-b border-[var(--border-subtle)]">
              {s.days.map(([d, v]) => (
                <div key={d} className="group relative flex-1 flex flex-col justify-end h-full">
                  <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[11px] font-semibold tabular-nums opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    {v}
                  </div>
                  <div
                    className="rounded-t-[4px] min-h-[2px] transition-colors"
                    style={{ height: `${(v / maxDay) * 100}%`, background: "var(--cool)" }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-[3px]">
              {s.days.map(([d], i) => (
                <span key={d} className="flex-1 text-center text-[10px] text-muted-2 tabular-nums overflow-hidden whitespace-nowrap">
                  {i % 2 === 0 ? d.split("-").reverse().join("/") : ""}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="bezel">
          <div className="bezel-inner p-6">
            <h2 className="mb-1 text-[15px] font-semibold">Phân loại lifecycle</h2>
            <p className="mb-5 text-[12.5px] text-muted">Theo tag SMAX hiện tại của {s.total} leads</p>
            <SimpleBar
              valueLabel="leads"
              data={[
                { label: "🔥 Hot Lead", value: s.hot, color: "var(--hot)" },
                { label: "🌡 Warm Lead", value: s.warm, color: "var(--warm)" },
                { label: "❄️ Cold Lead", value: s.cold, color: "var(--cool)" },
                { label: "◌ Chưa gắn tag lifecycle", value: s.untagged, color: "var(--muted-2, #9ca3af)" },
              ]}
            />
            <div className="mt-5 rounded-lg bg-subtle px-4 py-3 text-[12.5px] text-muted">
              <b className="text-foreground">{s.coInfoThieuTag} leads</b> đã có contact nhưng chưa được gắn
              tag lifecycle →{" "}
              <Link href="/smax-audit/cold" className="font-semibold text-foreground underline-offset-2 hover:underline">
                xem danh sách
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {[
          { href: "/smax-audit/unreplied", label: "Khách đang chờ rep", value: s.unreplied, desc: "xử lý sớm để không mất lead" },
          { href: "/smax-audit/cold", label: "Cold lead cần xin info", value: s.chuaXinInfo ?? "—", desc: "AI ghi rõ lý do từng lead" },
          { href: "/smax-audit/followup", label: "Hot/Warm im ắng 3+ ngày", value: "→", desc: "ứng viên follow-up tuần này" },
        ].map((c) => (
          <Link key={c.href} href={c.href} className="bezel card-lift group">
            <div className="bezel-inner flex items-center justify-between p-5">
              <div>
                <div className="eyebrow">{c.label}</div>
                <div className="mt-1 text-[22px] font-bold tabular-nums">{c.value}</div>
                <div className="text-[12px] text-muted">{c.desc}</div>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-2 transition-transform group-hover:translate-x-0.5" />
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
