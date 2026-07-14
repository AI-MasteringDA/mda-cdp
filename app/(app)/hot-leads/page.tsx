import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { LeadListItem } from "@/components/LeadListItem";
import { LeadListToolbar } from "@/components/LeadListToolbar";
import { getHotLeads, getHotLeadsCount, getAvailableStages, getTopHotProducts, getHotListViews, type LeadListFilter } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE_SIZE = 100;

export default async function HotLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; src?: string; stage?: string; product?: string; listView?: string; sort?: string; eng?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page || 1));
  const offset = (page - 1) * PAGE_SIZE;
  const engagement =
    params.eng === "engaged" || params.eng === "silent" ? (params.eng as "engaged" | "silent") : undefined;
  const filter: LeadListFilter = {
    source: params.src,
    stage: params.stage,
    product: params.product,
    listView: params.listView,
    engagement,
    sort: (params.sort as LeadListFilter["sort"]) || "score-desc",
  };
  const activeCourses = (process.env.ACTIVE_COURSES || "K61,F3 - 2026")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // Tuần tự, không Promise.all: 4 hàm chạy song song sẽ bắn >80 request
  // PostgREST cùng lúc và làm nghẽn connection pool của Supabase Free tier.
  // Mỗi phần tự bắt lỗi để một truy vấn hỏng không làm trắng cả trang —
  // trước đây trang trả 500 mà không nói gì.
  const errors: string[] = [];
  const guard = async <T,>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      return fallback;
    }
  };

  const hotLeads = await guard("danh sách lead", () => getHotLeads(PAGE_SIZE, offset, filter), []);
  const total = await guard("đếm tổng", () => getHotLeadsCount(filter), hotLeads.length);
  const stages = await guard("stage", () => getAvailableStages(), []);
  const products = await guard("sản phẩm", () => getTopHotProducts(15, activeCourses), []);
  const listViews = await guard("list view", () => getHotListViews(), []);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const qsBase = new URLSearchParams();
  if (params.src) qsBase.set("src", params.src);
  if (params.stage) qsBase.set("stage", params.stage);
  if (params.product) qsBase.set("product", params.product);
  if (params.listView) qsBase.set("listView", params.listView);
  if (params.eng) qsBase.set("eng", params.eng);
  if (params.sort && params.sort !== "score-desc") qsBase.set("sort", params.sort);
  const buildPageUrl = (p: number) => {
    const qs = new URLSearchParams(qsBase);
    if (p > 1) qs.set("page", String(p));
    return `/hot-leads${qs.toString() ? "?" + qs.toString() : ""}`;
  };
  // Link cho 3 nút lọc theo hành vi (giữ nguyên các filter khác)
  const engUrl = (v?: "engaged" | "silent") => {
    const qs = new URLSearchParams(qsBase);
    qs.delete("page");
    if (v) qs.set("eng", v);
    else qs.delete("eng");
    return `/hot-leads${qs.toString() ? "?" + qs.toString() : ""}`;
  };
  const ENG_TABS: { v?: "engaged" | "silent"; label: string; hint: string }[] = [
    { v: undefined, label: "Tất cả", hint: "Mọi lead điểm ≥70" },
    { v: "engaged", label: "✅ Có hành vi", hint: "Lead đã chat / click / reply / submit form / mua — intent được xác nhận" },
    { v: "silent", label: "⚠ Chỉ có tag", hint: "Sales tag NÓNG nhưng CDP chưa ghi nhận hành vi nào (có thể chat Zalo / gọi điện — kênh không track)" },
  ];

  return (
    <>
      <Topbar title="Lead NÓNG" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-4">
          <h1 className="text-[28px] font-semibold tracking-tight">
            🔥 {total.toLocaleString("vi-VN")} lead NÓNG — gọi NGAY hôm nay
          </h1>
          <p className="mt-1 text-[14px] text-muted">
            Điểm 70-100 · lead Sales tag NÓNG (SMAX/Salesforce) HOẶC có hành vi intent mạnh
            (chat, reply, click, form) trong 30 ngày qua.
          </p>
        </div>

        {errors.length > 0 && (
          <div className="mb-5 rounded-xl border border-[#fecaca] bg-[#fee2e2] px-4 py-3 text-[13px] text-[#991b1b]">
            <div className="font-semibold">Một số dữ liệu không tải được</div>
            <ul className="mt-1 list-inside list-disc space-y-0.5 font-mono text-[12px]">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Lọc theo hành vi — tách lead "tag NÓNG nhưng im lặng" khỏi lead có tương tác thật */}
        <div className="mb-5 flex flex-wrap items-center gap-2">
          {ENG_TABS.map((t) => {
            const active = (params.eng ?? undefined) === t.v;
            return (
              <Link
                key={t.label}
                href={engUrl(t.v)}
                title={t.hint}
                className={
                  "press rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors " +
                  (active
                    ? "border-foreground bg-foreground text-[var(--background)]"
                    : "border-[var(--border-subtle)] text-muted hover:bg-subtle hover:text-foreground")
                }
              >
                {t.label}
              </Link>
            );
          })}
        </div>

        <LeadListToolbar leads={hotLeads} total={total} availableStages={stages} availableProducts={products} activeCourses={activeCourses} availableListViews={listViews} exportFilename="hot-leads.csv" />

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
