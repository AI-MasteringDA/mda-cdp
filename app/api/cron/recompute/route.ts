import { NextResponse, type NextRequest } from "next/server";
import { admin } from "@/etl/lib/supabase-admin";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Recompute pipeline: aggregates → scores.
 * Call this after all source ETLs finish.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")?.trim();
  const secret = process.env.CRON_SECRET?.trim() || "";
  const expected = `Bearer ${secret}`;
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  if (!isVercelCron && authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const t0 = Date.now();
  let aggregatesOk = true;
  let aggregatesError: string | undefined;
  let aggregatesUpdated = 0;
  try {
    const { data, error } = await admin.rpc("recompute_lead_aggregates");
    if (error) {
      aggregatesOk = false;
      aggregatesError = error.message;
    } else {
      aggregatesUpdated = typeof data === "number" ? data : 0;
    }
  } catch (e) {
    aggregatesOk = false;
    aggregatesError = (e as Error).message;
  }
  const t1 = Date.now();

  let scoringOk = true;
  let scoringError: string | undefined;
  try {
    const { error } = await admin.rpc("recompute_lead_scores");
    if (error) {
      scoringOk = false;
      scoringError = error.message;
    }
  } catch (e) {
    scoringOk = false;
    scoringError = (e as Error).message;
  }
  const t2 = Date.now();

  return NextResponse.json({
    ok: aggregatesOk && scoringOk,
    aggregates: { ok: aggregatesOk, error: aggregatesError, updated: aggregatesUpdated, ms: t1 - t0 },
    scoring: { ok: scoringOk, error: scoringError, ms: t2 - t1 },
    totalMs: t2 - t0,
    timestamp: new Date().toISOString(),
  });
}
