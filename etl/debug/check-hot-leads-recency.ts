import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  // Date today
  const now = new Date();
  console.log(`🕐 Current time (UTC): ${now.toISOString()}\n`);

  // Get top hot leads (latest scored)
  const today = new Date().toISOString().slice(0, 10);
  const { data: scores } = await admin
    .from("fact_lead_score")
    .select("lead_id, hot_score")
    .eq("scored_at", today)
    .gte("hot_score", 70)
    .order("hot_score", { ascending: false })
    .limit(15);

  if (!scores || scores.length === 0) {
    console.log("No hot leads scored today.");
    return;
  }

  const leadIds = scores.map((s) => s.lead_id);
  const { data: leads } = await admin
    .from("dim_lead")
    .select("lead_id, full_name, first_seen_at, last_engagement_at, last_chat_at, last_chat_staff_at, last_email_at")
    .in("lead_id", leadIds);

  const leadMap = new Map((leads ?? []).map((l) => [l.lead_id, l]));

  console.log(`📋 Top 15 HOT leads — recency timestamps:\n`);
  console.log(`Lead                                   first_seen    last_engage   last_chat    last_chat_staff   days_ago`);
  console.log(`-`.repeat(150));

  for (const s of scores) {
    const l = leadMap.get(s.lead_id);
    if (!l) continue;
    const lastEng = l.last_engagement_at;
    const daysAgo = lastEng
      ? Math.floor((now.getTime() - new Date(lastEng).getTime()) / 86400_000)
      : 999;
    const fmt = (s: string | null) => (s ? s.slice(0, 16) : "—".padEnd(16));
    console.log(
      `${(l.full_name || "—").slice(0, 35).padEnd(38)} ` +
      `${fmt(l.first_seen_at).padEnd(14)} ` +
      `${fmt(l.last_engagement_at).padEnd(14)} ` +
      `${fmt(l.last_chat_at).padEnd(14)} ` +
      `${fmt(l.last_chat_staff_at).padEnd(17)} ` +
      `${daysAgo}d ago`
    );
  }

  // Get the actual LATEST touchpoint per these leads
  console.log(`\n📦 Latest touchpoint per lead (real activity):`);
  for (const lid of leadIds.slice(0, 5)) {
    const { data: tp } = await admin
      .from("fact_touchpoint")
      .select("event_type, source, occurred_at, title")
      .eq("lead_id", lid)
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const l = leadMap.get(lid);
    if (tp) {
      const daysAgo = Math.floor((now.getTime() - new Date(tp.occurred_at).getTime()) / 86400_000);
      console.log(`  ${l?.full_name?.slice(0, 30).padEnd(33)} → [${tp.occurred_at.slice(0, 16)}] (${daysAgo}d) ${tp.event_type} from ${tp.source}: "${tp.title?.slice(0, 50)}"`);
    }
  }
}

main().catch(console.error);
