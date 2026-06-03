import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { admin } from "../lib/supabase-admin";

async function timed<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  const s = Date.now();
  try {
    const r = await fn();
    console.log(`✓ ${name.padEnd(30)} ${Date.now() - s}ms`);
    return r;
  } catch (e) {
    console.error(`✗ ${name.padEnd(30)} FAILED: ${(e as Error).message}`);
    return null;
  }
}

async function main() {
  const from = new Date();
  from.setDate(from.getDate() - 30);
  const to = new Date();

  // KPI queries
  await timed("count conversion", () =>
    admin.from("fact_touchpoint").select("*", { count: "exact", head: true })
      .eq("event_type", "conversion").gte("occurred_at", from.toISOString()).lt("occurred_at", to.toISOString())
  );

  // getDailyActivity (the new optimized one - 30 days × 3 queries parallel)
  await timed("daily activity (90 queries)", async () => {
    const days = [];
    const d = new Date(from);
    d.setHours(0, 0, 0, 0);
    while (d <= to) {
      const end = new Date(d); end.setDate(end.getDate() + 1);
      days.push({ start: new Date(d), end });
      d.setDate(d.getDate() + 1);
    }
    await Promise.all(days.map((day) => Promise.all([
      admin.from("fact_touchpoint").select("*", { count: "exact", head: true }).in("event_type", ["chat","chat_staff"]).gte("occurred_at", day.start.toISOString()).lt("occurred_at", day.end.toISOString()),
      admin.from("fact_touchpoint").select("*", { count: "exact", head: true }).in("event_type", ["email_sent","email_open"]).gte("occurred_at", day.start.toISOString()).lt("occurred_at", day.end.toISOString()),
      admin.from("fact_touchpoint").select("*", { count: "exact", head: true }).eq("event_type", "conversion").gte("occurred_at", day.start.toISOString()).lt("occurred_at", day.end.toISOString()),
    ])));
  });

  // getTierDistribution
  await timed("tier distribution", async () => {
    const latest = await admin.from("fact_lead_score").select("scored_at").order("scored_at", { ascending: false }).limit(1).maybeSingle();
    const date = latest.data?.scored_at;
    if (!date) return null;
    return Promise.all([70, 40, 20, 0].map((min) =>
      admin.from("fact_lead_score").select("*", { count: "exact", head: true })
        .eq("scored_at", date).gte("hot_score", min)
    ));
  });

  // getSourceDistribution
  await timed("source distribution", () =>
    Promise.all(["salesforce", "smax", "instantly", "web"].flatMap((src) => [
      admin.from("fact_touchpoint").select("*", { count: "exact", head: true }).eq("source", src),
      admin.from("dim_lead").select("*", { count: "exact", head: true }).eq("source", src),
    ]))
  );

  // getConversionFunnel
  await timed("conversion funnel", () =>
    Promise.all([
      admin.from("dim_lead").select("*", { count: "exact", head: true }),
      admin.from("dim_lead").select("*", { count: "exact", head: true }).gt("total_touchpoints", 1),
      admin.from("dim_lead").select("*", { count: "exact", head: true }).gt("email_received_count", 0),
      admin.from("dim_lead").select("*", { count: "exact", head: true }).gt("chat_count", 0),
      admin.from("dim_lead").select("*", { count: "exact", head: true }).gt("conversion_count", 0),
    ])
  );

  // getConversionBySource
  await timed("conversion by source", async () => {
    const convLeads = new Set<string>();
    let r = 0;
    while (r < 5000) {
      const { data } = await admin.from("fact_touchpoint").select("lead_id").eq("event_type", "conversion").range(r, r + 999);
      if (!data || data.length === 0) break;
      for (const t of data) convLeads.add(t.lead_id);
      if (data.length < 1000) break;
      r += 1000;
    }
    return convLeads.size;
  });

  // getTopCampaigns
  await timed("top campaigns", () =>
    admin.from("fact_touchpoint").select("title, payload, lead_id, event_type").eq("source", "instantly").in("event_type", ["email_sent"]).range(0, 9999)
  );

  // getTvvPerformance
  await timed("tvv performance", () =>
    admin.from("dim_lead").select("assignee, conversion_count, chat_staff_count, total_touchpoints, stage").not("assignee", "is", null)
  );
}

main().then(() => process.exit(0)).catch((e) => { console.error("CRITICAL:", e); process.exit(1); });
