import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { evaluateHealth, type Snapshot } from "@/lib/health-metrics";

export const dynamic = "force-dynamic";

/**
 * Trạng thái sức khỏe data cho chuông trên Topbar + trang /health.
 * Đọc bảng data_health_snapshot (nhỏ, nhanh) thay vì đếm bảng lớn.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const since = new Date(Date.now() - 8 * 86400_000).toISOString();
    const { data } = await supabase
      .from("data_health_snapshot")
      .select("captured_at, source, touchpoints, leads, last_event_at")
      .gte("captured_at", since)
      .order("captured_at", { ascending: false })
      .limit(2000);

    const report = evaluateHealth((data ?? []) as Snapshot[]);
    return NextResponse.json(report);
  } catch {
    return NextResponse.json(
      { overall: "ok", sources: [], generatedAt: new Date().toISOString(), hasSnapshots: false },
      { status: 200 }
    );
  }
}
