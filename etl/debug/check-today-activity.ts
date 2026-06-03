import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const dayBeforeYesterday = new Date(yesterday);
  dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 1);

  console.log("=== Touchpoint activity per day ===\n");

  async function countOnDay(start: Date, end: Date) {
    const { count } = await admin
      .from("fact_touchpoint")
      .select("*", { count: "exact", head: true })
      .gte("occurred_at", start.toISOString())
      .lt("occurred_at", end.toISOString());
    return count ?? 0;
  }

  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const todayCount = await countOnDay(today, tomorrow);
  const yesterdayCount = await countOnDay(yesterday, today);
  const dbyCount = await countOnDay(dayBeforeYesterday, yesterday);

  console.log(`  Hôm nay (${today.toISOString().slice(0, 10)}):     ${todayCount}`);
  console.log(`  Hôm qua (${yesterday.toISOString().slice(0, 10)}):   ${yesterdayCount}`);
  console.log(`  2 ngày trước (${dayBeforeYesterday.toISOString().slice(0, 10)}):  ${dbyCount}`);

  console.log("\n=== By event type today ===");
  const types = ["chat", "chat_staff", "email_sent", "email_open", "conversion"];
  for (const t of types) {
    const { count } = await admin
      .from("fact_touchpoint")
      .select("*", { count: "exact", head: true })
      .eq("event_type", t)
      .gte("occurred_at", today.toISOString());
    console.log(`  ${t.padEnd(15)} ${count ?? 0}`);
  }

  console.log("\n=== By event type yesterday ===");
  for (const t of types) {
    const { count } = await admin
      .from("fact_touchpoint")
      .select("*", { count: "exact", head: true })
      .eq("event_type", t)
      .gte("occurred_at", yesterday.toISOString())
      .lt("occurred_at", today.toISOString());
    console.log(`  ${t.padEnd(15)} ${count ?? 0}`);
  }

  console.log("\n=== Last 5 sync_job runs ===");
  const { data: jobs } = await admin
    .from("sync_job")
    .select("source, status, started_at, finished_at, records_in, records_merged, error_message")
    .order("started_at", { ascending: false })
    .limit(8);
  for (const j of jobs ?? []) {
    const dur = j.finished_at ? Math.round((new Date(j.finished_at).getTime() - new Date(j.started_at).getTime()) / 1000) : "?";
    console.log(`  ${j.started_at.slice(0, 19)} | ${j.source.padEnd(10)} | ${j.status.padEnd(7)} | in:${j.records_in} merged:${j.records_merged} | ${dur}s ${j.error_message ? "| " + j.error_message.slice(0, 60) : ""}`);
  }
}

main().catch(console.error);
