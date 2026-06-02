import { NextResponse, type NextRequest } from "next/server";
import { admin } from "@/etl/lib/supabase-admin";
import { pullFromSalesforceReal } from "@/etl/sources/salesforce-real";
import { pullFromSmaxReal } from "@/etl/sources/smax-real";
import { pullFromInstantlyReal } from "@/etl/sources/instantly-real";
import { pullFromWixReal } from "@/etl/sources/wix-real";

// Vercel Pro: max 300s. Hobby: max 60s. Match plan.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type SourceResult = { source: string; ok: boolean; durationMs: number; error?: string };

async function runSource(name: string, fn: () => Promise<unknown>): Promise<SourceResult> {
  const start = Date.now();
  try {
    await fn();
    return { source: name, ok: true, durationMs: Date.now() - start };
  } catch (e) {
    return {
      source: name,
      ok: false,
      durationMs: Date.now() - start,
      error: (e as Error).message.slice(0, 200),
    };
  }
}

export async function GET(request: NextRequest) {
  // Verify cron secret — protects against unauthorized triggering
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  // Also allow Vercel Cron's built-in auth via x-vercel-cron header
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  if (!isVercelCron && authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const overallStart = Date.now();
  const results: SourceResult[] = [];

  // Run sources sequentially — each is incremental so should be fast
  // Order: light-weight first → heavy last (Instantly can timeout but resumes)
  results.push(await runSource("wix",        () => pullFromWixReal()));
  results.push(await runSource("smax",       () => pullFromSmaxReal()));
  results.push(await runSource("salesforce", () => pullFromSalesforceReal()));
  results.push(await runSource("instantly",  () => pullFromInstantlyReal()));

  // Recompute scores once
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

  const totalMs = Date.now() - overallStart;
  return NextResponse.json({
    ok: results.every((r) => r.ok) && scoringOk,
    totalMs,
    totalSec: Math.round(totalMs / 1000),
    sources: results,
    scoring: { ok: scoringOk, error: scoringError },
    timestamp: new Date().toISOString(),
  });
}
