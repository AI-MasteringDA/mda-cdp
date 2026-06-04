import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const source = url.searchParams.get("source");
  const minStr = url.searchParams.get("min");
  const maxStr = url.searchParams.get("max");
  const convertedOnly = url.searchParams.get("converted_only") === "true";

  if (!source || minStr === null) {
    return NextResponse.json({ error: "Missing source or min" }, { status: 400 });
  }
  const min = Number(minStr);
  const max = maxStr !== null ? Number(maxStr) : null;

  // Build query
  let q = supabase
    .from("dim_lead")
    .select("lead_id, full_name, email, phone, company, source, lead_source, stage, total_touchpoints, conversion_count, last_engagement_at, first_seen_at")
    .eq("source", source)
    .gte("total_touchpoints", min);
  if (max !== null) q = q.lte("total_touchpoints", max);
  if (convertedOnly) q = q.gt("conversion_count", 0);

  // Paginate
  const all: Record<string, unknown>[] = [];
  let fromRow = 0;
  while (fromRow < 50000) {
    const { data } = await q.range(fromRow, fromRow + 999);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    fromRow += 1000;
  }

  // Build CSV
  const headers = [
    "lead_id",
    "full_name",
    "email",
    "phone",
    "company",
    "source",
    "lead_source",
    "stage",
    "total_touchpoints",
    "conversion_count",
    "last_engagement_at",
    "first_seen_at",
  ];
  const rows = all.map((l) =>
    headers.map((h) => {
      const v = l[h];
      if (v === null || v === undefined) return "";
      return String(v);
    })
  );

  const csv =
    "﻿" + // UTF-8 BOM for Excel
    [headers, ...rows]
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="lookalike-${source}-${min}${max !== null ? `-${max}` : "+"}.csv"`,
    },
  });
}
