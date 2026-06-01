import { Topbar } from "@/components/Topbar";
import { LeadListItem } from "@/components/LeadListItem";
import { getHotLeads } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

export default async function HotLeadsPage() {
  const hotLeads = await getHotLeads(100);

  return (
    <>
      <Topbar title="Lead nóng" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6">
          <h1 className="text-[28px] font-semibold tracking-tight">
            {hotLeads.length} lead nóng đang chờ
          </h1>
          <p className="mt-1 text-[14px] text-muted">
            Đọc từ <code className="font-mono text-[12px] bg-subtle px-1.5 py-0.5 rounded">fact_lead_score</code> ·
            sắp xếp theo điểm nóng giảm dần.
          </p>
        </div>

        <div className="hairline rounded-2xl bg-white px-3 py-2">
          {hotLeads.length === 0 ? (
            <div className="px-6 py-12 text-center text-[13px] text-muted-2">
              Chưa có lead nóng nào. Chạy <code className="font-mono">seed.sql</code> để có data thử nghiệm.
            </div>
          ) : (
            hotLeads.map((lead) => (
              <LeadListItem key={lead.id} lead={lead} variant="hot" />
            ))
          )}
        </div>
      </main>
    </>
  );
}
