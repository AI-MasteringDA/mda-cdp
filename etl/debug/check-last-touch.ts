import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  // Sample top 5 hot leads — check what last_touch_at, last_engagement_at, etc. look like
  const { data } = await admin
    .from("dim_lead")
    .select("lead_id, full_name, email, first_seen_at, last_touch_at, last_engagement_at, last_chat_at, last_chat_staff_at, last_email_at, chat_count, chat_staff_count")
    .eq("source", "smax")
    .gt("chat_staff_count", 5)
    .order("last_chat_staff_at", { ascending: false })
    .limit(8);

  console.log(`📋 Sample hot leads — timestamp columns:\n`);
  for (const l of data ?? []) {
    console.log(`👤 ${l.full_name}`);
    console.log(`   first_seen_at:       ${l.first_seen_at?.slice(0, 16) || "—"}`);
    console.log(`   last_touch_at:       ${l.last_touch_at?.slice(0, 16) || "—"}  ← UI hiển thị cái này`);
    console.log(`   last_engagement_at:  ${l.last_engagement_at?.slice(0, 16) || "—"}  ← Real last activity`);
    console.log(`   last_chat_at:        ${l.last_chat_at?.slice(0, 16) || "—"}`);
    console.log(`   last_chat_staff_at:  ${l.last_chat_staff_at?.slice(0, 16) || "—"}`);
    console.log(`   last_email_at:       ${l.last_email_at?.slice(0, 16) || "—"}`);
    console.log();
  }

  // Count: how many leads have last_touch_at vs last_engagement_at populated?
  const { count: withTouch } = await admin
    .from("dim_lead")
    .select("*", { count: "exact", head: true })
    .not("last_touch_at", "is", null);
  const { count: withEngagement } = await admin
    .from("dim_lead")
    .select("*", { count: "exact", head: true })
    .not("last_engagement_at", "is", null);
  const { count: total } = await admin
    .from("dim_lead")
    .select("*", { count: "exact", head: true });

  console.log(`\n📊 Coverage:`);
  console.log(`   Total leads:               ${total}`);
  console.log(`   With last_touch_at:        ${withTouch}  (${total ? (((withTouch ?? 0) / total) * 100).toFixed(1) : 0}%)`);
  console.log(`   With last_engagement_at:   ${withEngagement}  (${total ? (((withEngagement ?? 0) / total) * 100).toFixed(1) : 0}%)`);
}

main().catch(console.error);
