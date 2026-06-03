import { NextResponse, type NextRequest } from "next/server";
import { admin } from "@/etl/lib/supabase-admin";
import { pullFromSalesforceReal } from "@/etl/sources/salesforce-real";
import { pullFromSmaxReal } from "@/etl/sources/smax-real";
import { pullFromInstantlyReal } from "@/etl/sources/instantly-real";
import { pullFromWixReal } from "@/etl/sources/wix-real";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const SOURCES: Record<string, () => Promise<unknown>> = {
  wix: pullFromWixReal,
  smax: pullFromSmaxReal,
  salesforce: pullFromSalesforceReal,
  instantly: pullFromInstantlyReal,
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ source: string }> }) {
  // Auth check (trim both sides for env newline safety)
  const authHeader = request.headers.get("authorization")?.trim();
  const secret = process.env.CRON_SECRET?.trim() || "";
  const expected = `Bearer ${secret}`;
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  if (!isVercelCron && authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { source } = await params;
  const fn = SOURCES[source];
  if (!fn) {
    return NextResponse.json({
      error: `Unknown source: ${source}`,
      available: Object.keys(SOURCES),
    }, { status: 400 });
  }

  const start = Date.now();
  let success = false;
  let errMsg: string | undefined;
  try {
    await fn();
    success = true;
  } catch (e) {
    errMsg = (e as Error).message.slice(0, 300);
  }

  const durationMs = Date.now() - start;
  const recompute = source === "instantly" || source === "salesforce";
  let scoringOk = true;
  let scoringErr: string | undefined;
  if (recompute) {
    try {
      const { error } = await admin.rpc("recompute_lead_scores");
      if (error) {
        scoringOk = false;
        scoringErr = error.message;
      }
    } catch (e) {
      scoringOk = false;
      scoringErr = (e as Error).message;
    }
  }

  return NextResponse.json({
    source,
    ok: success && scoringOk,
    durationMs,
    durationSec: Math.round(durationMs / 1000),
    error: errMsg,
    scoring: recompute ? { ok: scoringOk, error: scoringErr } : null,
    timestamp: new Date().toISOString(),
  }, { status: success ? 200 : 500 });
}
