import { NextResponse } from "next/server";
import { admin } from "@/etl/lib/supabase-admin";

export const dynamic = "force-dynamic";

/** GET /api/audiences/:id/export — CSV of audience members */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const { data: seg } = await admin.from("dim_segment").select("name").eq("segment_id", id).maybeSingle();
  if (!seg) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Fetch all members
  const memberIds: string[] = [];
  let from = 0;
  while (from < 100_000) {
    const { data } = await admin
      .from("fact_segment_member")
      .select("lead_id")
      .eq("segment_id", id)
      .range(from, from + 999);
    if (!data?.length) break;
    for (const m of data) memberIds.push(m.lead_id);
    if (data.length < 1000) break;
    from += 1000;
  }
  if (memberIds.length === 0) {
    return new NextResponse("full_name,email,phone,source,stage,sf_rating,sf_product,assignee", {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${seg.name}.csv"` },
    });
  }

  // Batch fetch leads
  const rows: Record<string, unknown>[] = [];
  const BATCH = 500;
  for (let i = 0; i < memberIds.length; i += BATCH) {
    const batch = memberIds.slice(i, i + BATCH);
    const { data } = await admin
      .from("dim_lead")
      .select("full_name, email, phone, source, stage, sf_rating, sf_product, assignee")
      .in("lead_id", batch);
    if (data?.length) rows.push(...(data as Record<string, unknown>[]));
  }

  const cols = ["full_name","email","phone","source","stage","sf_rating","sf_product","assignee"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [
    cols.join(","),
    ...rows.map((r) => cols.map((c) => esc(r[c])).join(",")),
  ].join("\n");

  const filename = `${seg.name.replace(/[^a-z0-9-_ ]/gi, "_")}.csv`;
  return new NextResponse("﻿" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
