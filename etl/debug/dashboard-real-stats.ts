import { admin } from "../lib/supabase-admin";

async function main() {
  console.log("=== Real Dashboard Stats ===\n");

  // Time ranges
  const now = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
  const twoWeekAgo = new Date(today); twoWeekAgo.setDate(twoWeekAgo.getDate() - 14);
  const monthAgo = new Date(today); monthAgo.setDate(monthAgo.getDate() - 30);
  const twoMonthAgo = new Date(today); twoMonthAgo.setDate(twoMonthAgo.getDate() - 60);

  async function countTouchpoints(eventType: string, fromDate: Date, toDate?: Date) {
    let q = admin.from("fact_touchpoint")
      .select("*", { count: "exact", head: true })
      .eq("event_type", eventType)
      .gte("occurred_at", fromDate.toISOString());
    if (toDate) q = q.lt("occurred_at", toDate.toISOString());
    const { count } = await q;
    return count ?? 0;
  }

  // 1. Conversions tuần này vs tuần trước
  console.log("--- Conversion tuần này ---");
  const convThisWeek = await countTouchpoints("conversion", weekAgo);
  const convLastWeek = await countTouchpoints("conversion", twoWeekAgo, weekAgo);
  console.log(`  This week:  ${convThisWeek}`);
  console.log(`  Last week:  ${convLastWeek}`);
  console.log(`  Delta:      ${convThisWeek - convLastWeek} (${convLastWeek ? ((convThisWeek - convLastWeek) / convLastWeek * 100).toFixed(1) : 0}%)`);

  // 2. Conversion rate (30d)
  console.log("\n--- Conversion rate (30 ngày) ---");
  const conv30d = await countTouchpoints("conversion", monthAgo);
  const leads30d = await countTouchpoints("lead_created", monthAgo);
  const convPrev30d = await countTouchpoints("conversion", twoMonthAgo, monthAgo);
  const leadsPrev30d = await countTouchpoints("lead_created", twoMonthAgo, monthAgo);
  const rate30d = leads30d ? (conv30d / leads30d * 100) : 0;
  const ratePrev30d = leadsPrev30d ? (convPrev30d / leadsPrev30d * 100) : 0;
  console.log(`  30d: ${conv30d} conv / ${leads30d} leads = ${rate30d.toFixed(2)}%`);
  console.log(`  Prev: ${convPrev30d} conv / ${leadsPrev30d} leads = ${ratePrev30d.toFixed(2)}%`);

  // 3. Active leads (có engagement trong 7 ngày)
  console.log("\n--- Đã tư vấn tuần này ---");
  // Distinct lead_ids with chat/chat_staff/call/meeting in last 7d
  const { data: engaged } = await admin
    .from("fact_touchpoint")
    .select("lead_id")
    .in("event_type", ["chat", "chat_staff", "call", "meeting"])
    .gte("occurred_at", weekAgo.toISOString());
  const engagedSet = new Set((engaged || []).map((r) => r.lead_id));
  console.log(`  Active leads tuần này: ${engagedSet.size}`);

  // 4. Total touchpoint hôm nay
  console.log("\n--- Activity hôm nay ---");
  const { count: todayCount } = await admin
    .from("fact_touchpoint")
    .select("*", { count: "exact", head: true })
    .gte("occurred_at", today.toISOString());
  console.log(`  Touchpoints hôm nay: ${todayCount ?? 0}`);

  // 5. Source breakdown
  console.log("\n--- Source distribution ---");
  for (const src of ["salesforce", "smax", "instantly", "web", "fanpage"]) {
    const { count } = await admin
      .from("fact_touchpoint")
      .select("*", { count: "exact", head: true })
      .eq("source", src);
    console.log(`  ${src.padEnd(12)} ${(count ?? 0).toLocaleString("vi-VN")}`);
  }

  // 6. Daily touchpoint trend last 30 days
  console.log("\n--- Daily touchpoint trend (last 30d) ---");
  const days: string[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  // Aggregate
  const { data: recent } = await admin
    .from("fact_touchpoint")
    .select("occurred_at, source")
    .gte("occurred_at", days[0])
    .limit(50000);
  const dailyCounts = new Map<string, number>();
  for (const r of recent || []) {
    const day = (r.occurred_at as string).slice(0, 10);
    dailyCounts.set(day, (dailyCounts.get(day) ?? 0) + 1);
  }
  for (const day of days.slice(-10)) {
    console.log(`  ${day}: ${dailyCounts.get(day) ?? 0}`);
  }
}

main().catch(console.error);
