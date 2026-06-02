import { Topbar } from "@/components/Topbar";
import { LeadListItem } from "@/components/LeadListItem";
import { getWarmLeads } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

export default async function WarmLeadsPage() {
  const warmLeads = await getWarmLeads(200);

  return (
    <>
      <Topbar title="Lead ấm" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6">
          <h1 className="text-[28px] font-semibold tracking-tight">
            {warmLeads.length} lead ấm — follow-up tuần này
          </h1>
          <p className="mt-1 text-[14px] text-muted">
            Lead có điểm nóng <strong>30 – 69</strong> · đã có engagement nhưng chưa đủ
            tiêu chí gọi NGAY. Đọc từ <code className="font-mono text-[12px] bg-subtle px-1.5 py-0.5 rounded">fact_lead_score</code>.
          </p>
        </div>

        <div className="hairline rounded-2xl bg-white px-3 py-2">
          {warmLeads.length === 0 ? (
            <div className="px-6 py-12 text-center text-[13px] text-muted-2">
              Chưa có lead ấm nào.
            </div>
          ) : (
            warmLeads.map((lead) => (
              <LeadListItem key={lead.id} lead={lead} variant="hot" />
            ))
          )}
        </div>
      </main>
    </>
  );
}
