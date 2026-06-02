import { Topbar } from "@/components/Topbar";
import { LeadListItem } from "@/components/LeadListItem";
import { getAllLeads, getAllLeadsCount } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function AllLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page || 1));
  const offset = (page - 1) * PAGE_SIZE;
  const searchQuery = params.q?.trim() || "";

  const [leads, total] = await Promise.all([
    getAllLeads(PAGE_SIZE, offset, searchQuery),
    getAllLeadsCount(searchQuery),
  ]);
  // Server already sorts by hot_score DESC for default mode; for search keep DB order
  const sorted = searchQuery
    ? [...leads].sort((a, b) => b.hotScore - a.hotScore)
    : leads;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const buildPageUrl = (p: number) => {
    const query = new URLSearchParams();
    if (searchQuery) query.set("q", searchQuery);
    if (p > 1) query.set("page", String(p));
    const qs = query.toString();
    return `/leads${qs ? "?" + qs : ""}`;
  };

  return (
    <>
      <Topbar title="Tất cả lead" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6">
          <h1 className="text-[28px] font-semibold tracking-tight">
            {searchQuery
              ? `${total.toLocaleString("vi-VN")} kết quả cho "${searchQuery}"`
              : `${total.toLocaleString("vi-VN")} học viên trong hệ thống`}
          </h1>
          <p className="mt-1 text-[14px] text-muted">
            {searchQuery ? (
              <>
                Match theo tên / email / SĐT chứa{" "}
                <code className="font-mono text-[12px] bg-subtle px-1.5 py-0.5 rounded">
                  {searchQuery}
                </code>{" "}
                · trang {page}/{totalPages}
              </>
            ) : (
              <>
                Hiển thị {leads.length} lead (trang {page}/{totalPages}) · sắp
                xếp theo điểm nóng. Đọc từ{" "}
                <code className="font-mono text-[12px] bg-subtle px-1.5 py-0.5 rounded">
                  dim_lead
                </code>
              </>
            )}
          </p>
        </div>

        <div className="hairline rounded-2xl bg-white px-3 py-2">
          {sorted.length === 0 ? (
            <div className="px-6 py-12 text-center text-[13px] text-muted-2">
              {searchQuery
                ? "Không tìm thấy lead nào khớp."
                : "Chưa có lead nào."}
            </div>
          ) : (
            sorted.map((lead) => <LeadListItem key={lead.id} lead={lead} />)
          )}
        </div>

        {totalPages > 1 && (
          <nav className="mt-6 flex items-center justify-center gap-2">
            {page > 1 && (
              <a
                href={buildPageUrl(page - 1)}
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
                href={buildPageUrl(page + 1)}
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
