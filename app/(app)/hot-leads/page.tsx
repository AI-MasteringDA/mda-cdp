import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { LeadListItem } from "@/components/LeadListItem";
import { LeadListToolbar } from "@/components/LeadListToolbar";
import { getHotLeads, getHotLeadsCount, type LeadListFilter } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function HotLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; src?: string; stage?: string; sort?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page || 1));
  const offset = (page - 1) * PAGE_SIZE;
  const filter: LeadListFilter = {
    source: params.src,
    stage: params.stage,
    sort: (params.sort as LeadListFilter["sort"]) || "score-desc",
  };
  const [hotLeads, total] = await Promise.all([
    getHotLeads(PAGE_SIZE, offset, filter),
    getHotLeadsCount(filter),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const qsBase = new URLSearchParams();
  if (params.src) qsBase.set("src", params.src);
  if (params.stage) qsBase.set("stage", params.stage);
  if (params.sort && params.sort !== "score-desc") qsBase.set("sort", params.sort);
  const buildPageUrl = (p: number) => {
    const qs = new URLSearchParams(qsBase);
    if (p > 1) qs.set("page", String(p));
    return `/hot-leads${qs.toString() ? "?" + qs.toString() : ""}`;
  };

  return (
    <>
      <Topbar title="Lead NÓNG" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6">
          <h1 className="text-[28px] font-semibold tracking-tight">
            🔥 {total.toLocaleString("vi-VN")} lead NÓNG — gọi NGAY hôm nay
          </h1>
          <p className="mt-1 text-[14px] text-muted">
            Điểm 70-100 · có signal mạnh trong 3-7 ngày qua. Tỉ lệ chốt 30-40%.
          </p>
        </div>

        <LeadListToolbar leads={hotLeads} total={total} exportFilename="hot-leads.csv" />

        <div className="hairline rounded-2xl bg-white px-3 py-2">
          {hotLeads.length === 0 ? (
            <div className="px-6 py-12 text-center text-[13px] text-muted-2">
              Không có lead nào khớp filter.
            </div>
          ) : (
            hotLeads.map((lead) => <LeadListItem key={lead.id} lead={lead} />)
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
