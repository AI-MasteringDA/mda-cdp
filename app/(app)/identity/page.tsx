import { Topbar } from "@/components/Topbar";
import { Toggle } from "@/components/ui/Toggle";
import { Chip } from "@/components/ui/Chip";
import { getIdentityStats } from "@/lib/supabase/queries";
import { Fingerprint, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

const TIER_CARDS = [
  {
    tier: 1,
    name: "Khớp xác định (deterministic)",
    detail: "Email/SĐT trùng khớp tuyệt đối. Đang chạy trong identity.ts khi ETL pull data.",
    enabled: true,
  },
  {
    tier: 2,
    name: "Khớp xác suất (Splink fuzzy)",
    detail: "Khớp lệch: tên dấu/không dấu, email khác đuôi. Chưa cài đặt — cần Python + Splink ở V2.",
    enabled: false,
  },
  {
    tier: 3,
    name: "LLM phân xử (Claude API)",
    detail: "Chỉ ca mơ hồ còn sót sau tầng 1-2. Chưa cài đặt — cần Anthropic API key ở V3.",
    enabled: false,
  },
];

export default async function IdentityPage() {
  const stats = await getIdentityStats();

  return (
    <>
      <Topbar title="Định danh" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6">
          <h1 className="text-[28px] font-semibold tracking-tight">Hợp nhất danh tính</h1>
          <p className="mt-1 text-[14px] text-muted">
            Trạng thái thực từ <code className="font-mono text-[12px] bg-subtle px-1.5 py-0.5 rounded">dim_lead</code>.
          </p>
        </div>

        <section className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
          <StatCard label="Tổng lead" value={stats.total.toLocaleString("vi-VN")} />
          <StatCard label="Có email" value={stats.withEmail.toLocaleString("vi-VN")} />
          <StatCard label="Có SĐT" value={stats.withPhone.toLocaleString("vi-VN")} />
          <StatCard label="Có cả 2" value={stats.withBoth.toLocaleString("vi-VN")} />
        </section>

        <section className="hairline rounded-2xl bg-white p-6 mb-6">
          <div className="flex items-start gap-3">
            <Fingerprint className="mt-1 h-5 w-5 text-muted" strokeWidth={1.75} />
            <div className="flex-1">
              <h2 className="text-[15px] font-semibold tracking-tight">Field định danh chính</h2>
              <p className="mt-1 text-[13px] text-muted">
                App đang ưu tiên <strong>email</strong> trước, fallback <strong>phone</strong>.
                Logic ở <code className="font-mono text-[11px] bg-subtle px-1 py-0.5 rounded">etl/lib/identity.ts</code>.
              </p>
            </div>
          </div>
        </section>

        <section className="hairline rounded-2xl bg-white">
          <div className="hairline-b px-6 py-4">
            <h2 className="text-[15px] font-semibold tracking-tight">3 tầng hợp nhất</h2>
          </div>
          {TIER_CARDS.map((t) => (
            <div
              key={t.tier}
              className="flex items-start gap-4 border-b border-[var(--border-subtle)] px-6 py-4 last:border-0"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-subtle text-[12px] font-semibold">
                {t.tier}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-medium">{t.name}</span>
                  {!t.enabled && <Chip variant="outline">Chưa cài</Chip>}
                </div>
                <p className="mt-1 text-[12px] text-muted leading-relaxed">{t.detail}</p>
              </div>
              <Toggle checked={t.enabled} disabled={!t.enabled} />
            </div>
          ))}
        </section>

        {stats.unmergedCount > 0 && (
          <section className="mt-6 hairline rounded-2xl bg-[#fff8f0] p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-[var(--warm)]" strokeWidth={1.75} />
              <div>
                <h3 className="text-[14px] font-semibold tracking-tight">
                  {stats.unmergedCount.toLocaleString("vi-VN")} lead chỉ có 1 định danh
                </h3>
                <p className="mt-1 text-[12px] text-muted leading-relaxed">
                  Đây là lead chỉ có email HOẶC phone, chưa đủ 2 định danh. Khi pull nguồn khác về cùng người này,
                  tầng 2 (fuzzy) sẽ giúp gộp.
                </p>
              </div>
            </div>
          </section>
        )}
      </main>
    </>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="hairline rounded-2xl bg-white p-5">
      <div className="text-[11px] uppercase tracking-wider text-muted-2 font-medium">{label}</div>
      <div className="mt-2 text-[24px] font-semibold tabular-nums">{value}</div>
    </div>
  );
}
