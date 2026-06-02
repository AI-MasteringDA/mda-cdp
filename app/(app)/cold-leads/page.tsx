import { Topbar } from "@/components/Topbar";
import { LeadListItem } from "@/components/LeadListItem";
import { getColdLeads, getColdLeadsCount } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function ColdLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page || 1));
  const offset = (page - 1) * PAGE_SIZE;
  const [coldLeads, total] = await Promise.all([
    getColdLeads(PAGE_SIZE, offset),
    getColdLeadsCount(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <Topbar title="Lead nguội" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6">
          <h1 className="text-[28px] font-semibold tracking-tight">
            {total.toLocaleString("vi-VN")} lead nguội cần cứu
          </h1>
          <p className="mt-1 text-[14px] text-muted">
            Lead đang nguội (cold_score ≥ 40). Hiển thị {coldLeads.length} lead
            (trang {page}/{totalPages}) · sắp xếp theo điểm nguội giảm dần.
          </p>
        </div>

        <div className="hairline rounded-2xl bg-white px-3 py-2">
          {coldLeads.length === 0 ? (
            <div className="px-6 py-12 text-center text-[13px] text-muted-2">
              Chưa có lead nguội nào.
            </div>
          ) : (
            coldLeads.map((lead) => (
              <LeadListItem key={lead.id} lead={lead} variant="cold" />
            ))
          )}
        </div>

        {totalPages > 1 && (
          <nav className="mt-6 flex items-center justify-center gap-2">
            {page > 1 && (
              <a
                href={`/cold-leads${page - 1 > 1 ? `?page=${page - 1}` : ""}`}
                className="rounded-lg border border-[var(--border-subtle)] bg-white px-3 py-1.5 text-[13px] hover:bg-subtle"
              >
                ← Trước
              </a>
            )}
            <span className="text-[13px] text-muted px-3">
              Trang {page} / {totalPages}
            </span>
            {page < totalPages && (
              <a
                href={`/cold-leads?page=${page + 1}`}
                className="rounded-lg border border-[var(--border-subtle)] bg-white px-3 py-1.5 text-[13px] hover:bg-subtle"
              >
                Sau →
              </a>
            )}
          </nav>
        )}
      </main>
    </>
  );
}
