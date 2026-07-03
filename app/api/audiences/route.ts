import { NextResponse } from "next/server";
import { admin } from "@/etl/lib/supabase-admin";
import { evaluateSegment } from "@/lib/segments/evaluator";
import type { FilterGroup } from "@/lib/segments/types";

export const dynamic = "force-dynamic";

/** GET /api/segments — list all segments */
export async function GET() {
  const { data, error } = await admin
    .from("dim_segment")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ segments: data ?? [] });
}

/** POST /api/segments — create new segment (evaluates and stores members immediately) */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    name: string;
    description?: string;
    filters: FilterGroup;
    created_by?: string;
  };

  if (!body?.name?.trim()) return NextResponse.json({ error: "Missing name" }, { status: 400 });
  if (!body?.filters?.rules) return NextResponse.json({ error: "Missing filters" }, { status: 400 });

  const memberIds = await evaluateSegment(body.filters);

  const { data: seg, error: insErr } = await admin
    .from("dim_segment")
    .insert({
      name: body.name.trim(),
      description: body.description?.trim() || null,
      filters: body.filters,
      created_by: body.created_by || null,
      matching_count: memberIds.length,
      last_computed_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (insErr || !seg) return NextResponse.json({ error: insErr?.message || "insert failed" }, { status: 500 });

  if (memberIds.length > 0) {
    const rows = memberIds.map((lead_id) => ({ segment_id: seg.segment_id, lead_id }));
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error: memErr } = await admin.from("fact_segment_member").insert(rows.slice(i, i + BATCH));
      if (memErr && !memErr.message.includes("duplicate key")) {
        return NextResponse.json({ error: `member insert: ${memErr.message}` }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ segment: seg, matching_count: memberIds.length });
}
