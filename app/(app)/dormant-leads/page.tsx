import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { LeadListItem } from "@/components/LeadListItem";
import { LeadListToolbar } from "@/components/LeadListToolbar";
import { getDormantLeads, getDormantLeadsCount, getAvailableStages, type LeadListFilter } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function DormantLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; src?: string; stage?: string; product?: string; sort?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page || 1));
  const offset = (page - 1) * PAGE_SIZE;
  const filter: LeadListFilter = {
    source: params.src,
    stage: params.stage,
    product: params.product,
    sort: (params.sort as LeadListFilter["sort"]) || "score-desc",
  };
  const [leads, total, stages] = await Promise.all([
    getDormantLeads(PAGE_SIZE, offset, filter),
    getDormantLeadsCount(filter),
    getAvailableStages(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const qsBase = new URLSearchParams();
  if (params.src) qsBase.set("src", params.src);
  if (params.stage) qsBase.set("stage", params.stage);
  if (params.product) qsBase.set("product", params.product);
  if (params.sort && params.sort !== "score-desc") qsBase.set("sort", params.sort);
  const buildPageUrl = (p: number) => {
    const qs = new URLSearchParams(qsBase);
    if (p > 1) qs.set("page", String(p));
    return `/dormant-leads${qs.toString() ? "?" + qs.toString() : ""}`;
  };

  return (
    <>
      <Topbar title="Lead NGỦ ĐÔNG" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6">
          <h1 className="text-[28px] font-semibold tracking-tight">
            💤 {total.toLocaleString("vi-VN")} lead NGỦ ĐÔNG — xem xét đóng case
          </h1>
          <p className="mt-1 text-[14px] text-muted">
            Điểm 0-19 · im lặng &gt; 180 ngày hoặc chưa từng tương tác. Nên archive hoặc batch final email.
          </p>
        </div>

        <LeadListToolbar leads={leads} total={total} availableStages={stages} exportFilename="dormant-leads.csv" />

        <div className="hairline rounded-2xl bg-white px-3 py-2">
          {leads.length === 0 ? (
            <div className="px-6 py-12 text-center text-[13px] text-muted-2">
              Không có lead nào khớp filter.
            </div>
          ) : (
            leads.map((lead) => <LeadListItem key={lead.id} lead={lead} />)
          )}
        </div>

        {totalPages > 1 && (
          <nav className="mt-6 flex items-center justify-center gap-2">
            {page > 1 && (
              <Link href={buildPageUrl(page - 1)} className="press rounded-lg border border-[var(--border-subtle)] bg-white px-3 py-1.5 text-[13px] hover:bg-subtle">← Trước</Link>
            )}
            <span className="text-[13px] text-muted px-3">Trang {page} / {totalPages}</span>
            {page < totalPages && (
              <Link href={buildPageUrl(page + 1)} className="press rounded-lg border border-[var(--border-subtle)] bg-white px-3 py-1.5 text-[13px] hover:bg-subtle">Sau →</Link>
            )}
          </nav>
        )}
      </main>
    </>
  );
}
