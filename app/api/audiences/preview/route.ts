import { NextResponse } from "next/server";
import { evaluateSegment } from "@/lib/segments/evaluator";
import type { FilterGroup } from "@/lib/segments/types";

export const dynamic = "force-dynamic";

/** POST /api/segments/preview — count matching leads WITHOUT saving */
export async function POST(req: Request) {
  const body = (await req.json()) as { filters: FilterGroup };
  if (!body?.filters?.rules) return NextResponse.json({ count: 0 });
  const matches = await evaluateSegment(body.filters);
  return NextResponse.json({ count: matches.length });
}
