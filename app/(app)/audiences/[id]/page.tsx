import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { admin } from "@/etl/lib/supabase-admin";
import { ArrowLeft, Download } from "lucide-react";
import { AudienceActions } from "@/components/segments/AudienceActions";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 100;

export default async function AudienceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam || 1));
  const offset = (page - 1) * PAGE_SIZE;

  const { data: seg } = await admin.from("dim_segment").select("*").eq("segment_id", id).maybeSingle();
  if (!seg) return notFound();

  // Fetch members (paginated)
  const { data: members } = await admin
    .from("fact_segment_member")
    .select("lead_id")
    .eq("segment_id", id)
    .range(offset, offset + PAGE_SIZE - 1);
  const memberIds = (members ?? []).map((m) => m.lead_id);

  const { data: leads } = memberIds.length
    ? await admin.from("dim_lead").select("lead_id, full_name, email, phone, source, stage, sf_rating, sf_product").in("lead_id", memberIds)
    : { data: [] };

  const total = seg.matching_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <Topbar title={seg.name} />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <Link href="/audiences" className="press inline-flex items-center gap-1 text-[12px] text-muted hover:text-foreground mb-4">
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} /> Tất cả audiences
        </Link>

        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">{seg.name}</h1>
            {seg.description && <p className="mt-1 text-[14px] text-muted">{seg.description}</p>}
            <div className="mt-2 text-[12px] text-muted-2">
              {(seg.matching_count ?? 0).toLocaleString("vi-VN")} leads · Cập nhật {seg.last_computed_at ? new Date(seg.last_computed_at).toLocaleString("vi-VN") : "—"}
            </div>
          </div>
          <AudienceActions segmentId={seg.segment_id} name={seg.name} />
        </div>

        <a
          href={`/api/audiences/${seg.segment_id}/export`}
          className="press inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-white px-3 py-1.5 text-[12px] hover:bg-subtle mb-3"
        >
          <Download className="h-3.5 w-3.5" strokeWidth={1.75} /> Export CSV
        </a>

        <div className="hairline rounded-2xl bg-white overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-subtle text-[11px] uppercase tracking-wider text-muted-2">
              <tr>
                <th className="px-4 py-2.5 text-left">Tên</th>
                <th className="px-4 py-2.5 text-left">Email</th>
                <th className="px-4 py-2.5 text-left">Phone</th>
                <th className="px-4 py-2.5 text-left">Source</th>
                <th className="px-4 py-2.5 text-left">Stage</th>
                <th className="px-4 py-2.5 text-left">SF Rating</th>
                <th className="px-4 py-2.5 text-left">Product</th>
              </tr>
            </thead>
            <tbody>
              {(leads ?? []).map((l) => (
                <tr key={l.lead_id} className="border-t border-[var(--border-subtle)] hover:bg-subtle">
                  <td className="px-4 py-2.5">
                    <Link href={`/lead/${l.lead_id}`} className="text-foreground hover:underline">{l.full_name || "—"}</Link>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{l.email || "—"}</td>
                  <td className="px-4 py-2.5 text-muted">{l.phone || "—"}</td>
                  <td className="px-4 py-2.5 text-muted">{l.source}</td>
                  <td className="px-4 py-2.5 text-muted">{l.stage}</td>
                  <td className="px-4 py-2.5">
                    {l.sf_rating === "Hot" && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700">Hot</span>}
                    {l.sf_rating === "Warm" && <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[11px] font-medium text-orange-700">Warm</span>}
                    {l.sf_rating === "Cold" && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">Cold</span>}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{l.sf_product || "—"}</td>
                </tr>
              ))}
              {(leads ?? []).length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-[13px] text-muted-2">Chưa có lead nào khớp filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <nav className="mt-6 flex items-center justify-center gap-2">
            {page > 1 && (
              <Link href={`/audiences/${seg.segment_id}?page=${page - 1}`} className="press rounded-lg border border-[var(--border-subtle)] bg-white px-3 py-1.5 text-[13px] hover:bg-subtle">← Trước</Link>
            )}
            <span className="text-[13px] text-muted px-3">Trang {page} / {totalPages}</span>
            {page < totalPages && (
              <Link href={`/audiences/${seg.segment_id}?page=${page + 1}`} className="press rounded-lg border border-[var(--border-subtle)] bg-white px-3 py-1.5 text-[13px] hover:bg-subtle">Sau →</Link>
            )}
          </nav>
        )}
      </main>
    </>
  );
}
