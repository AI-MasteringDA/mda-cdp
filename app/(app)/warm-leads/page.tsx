import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { LeadListItem } from "@/components/LeadListItem";
import { getWarmLeads, getWarmLeadsCount } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function WarmLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page || 1));
  const offset = (page - 1) * PAGE_SIZE;
  const [leads, total] = await Promise.all([
    getWarmLeads(PAGE_SIZE, offset),
    getWarmLeadsCount(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <Topbar title="Lead ẤM" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6">
          <h1 className="text-[28px] font-semibold tracking-tight">
            🌡 {total.toLocaleString("vi-VN")} lead ẤM — follow-up tuần này
          </h1>
          <p className="mt-1 text-[14px] text-muted">
            Điểm 40-69 · có engagement, đang cân nhắc. Tỉ lệ chốt 8-15% nếu chăm đúng cách.
          </p>
        </div>

        <div className="hairline rounded-2xl bg-white px-3 py-2">
          {leads.length === 0 ? (
            <div className="px-6 py-12 text-center text-[13px] text-muted-2">
              Chưa có lead ấm nào.
            </div>
          ) : (
            leads.map((lead) => <LeadListItem key={lead.id} lead={lead} />)
          )}
        </div>

        {totalPages > 1 && (
          <nav className="mt-6 flex items-center justify-center gap-2">
            {page > 1 && (
              <Link href={`/warm-leads${page - 1 > 1 ? `?page=${page - 1}` : ""}`} className="press rounded-lg border border-[var(--border-subtle)] bg-white px-3 py-1.5 text-[13px] hover:bg-subtle">← Trước</Link>
            )}
            <span className="text-[13px] text-muted px-3">Trang {page} / {totalPages}</span>
            {page < totalPages && (
              <Link href={`/warm-leads?page=${page + 1}`} className="press rounded-lg border border-[var(--border-subtle)] bg-white px-3 py-1.5 text-[13px] hover:bg-subtle">Sau →</Link>
            )}
          </nav>
        )}
      </main>
    </>
  );
}
