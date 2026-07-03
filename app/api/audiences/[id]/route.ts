import { NextResponse } from "next/server";
import { admin } from "@/etl/lib/supabase-admin";
import { evaluateSegment } from "@/lib/segments/evaluator";
import type { FilterGroup } from "@/lib/segments/types";

export const dynamic = "force-dynamic";

/** GET /api/segments/:id — segment detail + member sample */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { data: seg } = await admin.from("dim_segment").select("*").eq("segment_id", id).maybeSingle();
  if (!seg) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ segment: seg });
}

/** DELETE /api/segments/:id */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { error } = await admin.from("dim_segment").delete().eq("segment_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** PATCH /api/segments/:id — update filters + re-evaluate members */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as {
    name?: string;
    description?: string;
    filters?: FilterGroup;
  };
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name?.trim()) patch.name = body.name.trim();
  if (body.description !== undefined) patch.description = body.description?.trim() || null;

  if (body.filters?.rules) {
    const memberIds = await evaluateSegment(body.filters);
    patch.filters = body.filters;
    patch.matching_count = memberIds.length;
    patch.last_computed_at = new Date().toISOString();

    await admin.from("fact_segment_member").delete().eq("segment_id", id);
    if (memberIds.length > 0) {
      const rows = memberIds.map((lead_id) => ({ segment_id: id, lead_id }));
      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        await admin.from("fact_segment_member").insert(rows.slice(i, i + BATCH));
      }
    }
  }

  const { data, error } = await admin.from("dim_segment").update(patch).eq("segment_id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ segment: data });
}
