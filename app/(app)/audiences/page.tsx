import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { admin } from "@/etl/lib/supabase-admin";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AudiencesPage() {
  const { data: segments } = await admin
    .from("dim_segment")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <>
      <Topbar title="Audiences" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">
              🎯 Audiences — nhóm lead động
            </h1>
            <p className="mt-1 text-[14px] text-muted">
              Tạo audience bằng filter rules · auto-recompute khi cần · export CSV · nền cho campaign & journey.
            </p>
          </div>
          <Link
            href="/audiences/new"
            className="press inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-[13px] font-medium text-background hover:opacity-90"
          >
            <Plus className="h-4 w-4" strokeWidth={2} /> Tạo audience
          </Link>
        </div>

        {(!segments || segments.length === 0) ? (
          <div className="hairline rounded-2xl bg-white px-6 py-16 text-center">
            <div className="text-[14px] text-muted-2">Chưa có audience nào.</div>
            <Link
              href="/audiences/new"
              className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-white px-3 py-1.5 text-[13px] hover:bg-subtle"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} /> Tạo audience đầu tiên
            </Link>
          </div>
        ) : (
          <div className="hairline rounded-2xl bg-white px-3 py-2">
            {segments.map((seg) => (
              <Link
                key={seg.segment_id}
                href={`/audiences/${seg.segment_id}`}
                className="press flex items-center justify-between rounded-xl px-4 py-3 hover:bg-subtle"
              >
                <div>
                  <div className="text-[15px] font-medium">{seg.name}</div>
                  {seg.description && <div className="text-[12px] text-muted mt-0.5">{seg.description}</div>}
                  <div className="mt-1 text-[11px] text-muted-2">
                    Cập nhật {seg.last_computed_at ? new Date(seg.last_computed_at).toLocaleString("vi-VN") : "chưa"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[20px] font-semibold">{(seg.matching_count ?? 0).toLocaleString("vi-VN")}</div>
                  <div className="text-[11px] text-muted-2">leads</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
