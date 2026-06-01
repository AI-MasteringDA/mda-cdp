import { Topbar } from "@/components/Topbar";
import { LeadListItem } from "@/components/LeadListItem";
import { getColdLeads } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

export default async function ColdLeadsPage() {
  const coldLeads = await getColdLeads(100);

  return (
    <>
      <Topbar title="Lead nguội" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6">
          <h1 className="text-[28px] font-semibold tracking-tight">
            {coldLeads.length} lead nguội cần cứu
          </h1>
          <p className="mt-1 text-[14px] text-muted">
            Lead đang nguội. Liên hệ trong 48h tới để không mất hẳn khỏi phễu.
          </p>
        </div>

        <div className="hairline rounded-2xl bg-white px-3 py-2">
          {coldLeads.length === 0 ? (
            <div className="px-6 py-12 text-center text-[13px] text-muted-2">
              Chưa có lead nguội nào. Chạy <code className="font-mono">seed.sql</code> để có data thử nghiệm.
            </div>
          ) : (
            coldLeads.map((lead) => (
              <LeadListItem key={lead.id} lead={lead} variant="cold" />
            ))
          )}
        </div>
      </main>
    </>
  );
}
