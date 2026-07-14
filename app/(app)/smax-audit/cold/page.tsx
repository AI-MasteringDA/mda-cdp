import { Chip } from "@/components/ui/Chip";
import { EmptyConfigCard } from "@/components/EmptyConfigCard";
import { AuditDateFilter } from "@/components/AuditDateFilter";
import { getAuditData, parseRange } from "@/lib/smax-audit";
import { formatRelativeVi } from "@/lib/utils";
import { PhoneMissed, Tags } from "lucide-react";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SP = Promise<{ from?: string; to?: string }>;

export default async function ColdAuditPage({ searchParams }: { searchParams: SP }) {
  const range = parseRange(await searchParams);
  const data = await getAuditData(range);
  // (a) TVV chưa từng xin thông tin liên hệ (AI đọc hội thoại xác nhận)
  const chuaXin = data.leads
    .filter((l) => l.chuaXinInfo === true)
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  // (b) Đã có contact nhưng quên gắn tag lifecycle
  const thieuTag = data.leads
    .filter((l) => l.hasContact && l.lifecycle === "none")
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));

  return (
    <main className="mx-auto max-w-[1280px] px-8 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Cold Lead Audit</h1>
          <p className="mt-1 text-[14px] text-muted">
            Hai lỗ hổng của cold lead: (a) chưa từng xin info · (b) có info rồi nhưng quên gắn tag.
          </p>
        </div>
        <AuditDateFilter from={range.from} to={range.to} />
      </div>

      <section className="mb-10">
        <div className="mb-3 flex items-center gap-2">
          <PhoneMissed className="h-4.5 w-4.5 text-[var(--warm)]" strokeWidth={1.75} />
          <h2 className="text-[17px] font-semibold">
            Chưa xin info <span className="text-muted font-normal">— {chuaXin.length} leads</span>
          </h2>
        </div>
        {!data.larkOk ? (
          <EmptyConfigCard
            icon={PhoneMissed}
            title="Chưa kết nối được Lark"
            description="Cột 'Chưa xin info' do AI ghi trên Lark Base. Thêm LARK_APP_ID / LARK_APP_SECRET / LARK_BASE_APP_TOKEN vào env của app để hiển thị."
          />
        ) : chuaXin.length === 0 ? (
          <EmptyConfigCard icon={PhoneMissed} title="Sạch sẽ 🎉" description="Mọi lead hoạt động 14 ngày qua đều đã được xin thông tin liên hệ." />
        ) : (
          <div className="bezel">
            <div className="bezel-inner overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-left">
                    <th className="px-5 py-3 eyebrow">Khách</th>
                    <th className="px-5 py-3 eyebrow">Hoạt động</th>
                    <th className="px-5 py-3 eyebrow">AI ghi nhận</th>
                  </tr>
                </thead>
                <tbody>
                  {chuaXin.map((l) => (
                    <tr key={l.lead_id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-subtle/50">
                      <td className="px-5 py-3 font-semibold whitespace-nowrap">{l.name}</td>
                      <td className="px-5 py-3 text-muted whitespace-nowrap tabular-nums">
                        {formatRelativeVi(new Date(l.lastActivity))}
                      </td>
                      <td className="px-5 py-3 text-muted max-w-[520px]">
                        {l.aiNote?.replace(/^Chưa xin info:\s*/, "") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <Tags className="h-4.5 w-4.5 text-[var(--cool)]" strokeWidth={1.75} />
          <h2 className="text-[17px] font-semibold">
            Có contact, thiếu tag lifecycle <span className="text-muted font-normal">— {thieuTag.length} leads</span>
          </h2>
        </div>
        <p className="mb-3 text-[13px] text-muted">
          Đã xin được SĐT/email nhưng chưa gắn Hot/Warm/Cold Lead → không lọt vào phễu chăm sóc nào.
        </p>
        {thieuTag.length === 0 ? (
          <EmptyConfigCard icon={Tags} title="Không có lead nào" description="Mọi lead có contact đều đã được phân loại." />
        ) : (
          <div className="bezel">
            <div className="bezel-inner overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-left">
                    <th className="px-5 py-3 eyebrow">Khách</th>
                    <th className="px-5 py-3 eyebrow">Contact</th>
                    <th className="px-5 py-3 eyebrow">Tag hiện có</th>
                    <th className="px-5 py-3 eyebrow">Hoạt động</th>
                  </tr>
                </thead>
                <tbody>
                  {thieuTag.map((l) => (
                    <tr key={l.lead_id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-subtle/50">
                      <td className="px-5 py-3 font-semibold whitespace-nowrap">{l.name}</td>
                      <td className="px-5 py-3 text-muted whitespace-nowrap tabular-nums">
                        {l.phone || l.email || "—"}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-1">
                          {l.tags.slice(0, 4).map((t) => (
                            <Chip key={t} variant="outline">{t}</Chip>
                          ))}
                          {l.tags.length > 4 && <span className="text-[11px] text-muted-2">+{l.tags.length - 4}</span>}
                          {l.tags.length === 0 && <span className="text-muted">chưa có tag</span>}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-muted whitespace-nowrap tabular-nums">
                        {formatRelativeVi(new Date(l.lastActivity))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
