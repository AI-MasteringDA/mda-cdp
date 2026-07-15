/**
 * Health check — đo số liệu data hiện tại, ghi snapshot, so với đỉnh 7 ngày,
 * bắn cảnh báo Lark nếu bất thường. Chạy định kỳ qua GitHub Actions.
 *
 * Lark webhook: tạo "Custom Bot" trong group Lark → dán URL vào env
 * LARK_ALERT_WEBHOOK. Thiếu webhook thì chỉ log ra console (không lỗi).
 */
import { admin } from "../lib/supabase-admin";
import { evaluateHealth, reportToLarkText, type Snapshot } from "../lib/health-metrics";

const SOURCES = ["smax", "salesforce", "instantly", "web"] as const;
const WEBHOOK = process.env.LARK_ALERT_WEBHOOK?.trim();
// Bắn heartbeat "✅ khỏe" mỗi ngày 1 lần (giờ VN ~8h) để biết monitor còn sống.
const HEARTBEAT_HOUR_VN = Number(process.env.HEALTH_HEARTBEAT_HOUR || 8);

async function countSource(source: string) {
  const { count: tp } = await admin.from("fact_touchpoint")
    .select("*", { count: "exact", head: true }).eq("source", source);
  const { count: leads } = await admin.from("dim_lead")
    .select("*", { count: "exact", head: true }).eq("source", source);
  const { data: newest } = await admin.from("fact_touchpoint")
    .select("occurred_at").eq("source", source)
    .order("occurred_at", { ascending: false }).limit(1);
  return {
    touchpoints: tp ?? 0,
    leads: leads ?? 0,
    last_event_at: newest?.[0]?.occurred_at ?? null,
  };
}

async function sendLark(text: string) {
  if (!WEBHOOK) { console.log("(LARK_ALERT_WEBHOOK chưa set — chỉ log)\n" + text); return; }
  try {
    const res = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msg_type: "text", content: { text } }),
    });
    const data = await res.json().catch(() => ({}));
    console.log(`Lark webhook: ${res.status} ${JSON.stringify(data).slice(0, 120)}`);
  } catch (e) {
    console.warn(`⚠️ gửi Lark lỗi: ${(e as Error).message}`);
  }
}

async function main() {
  console.log("🩺 [Health] Đo số liệu data...");

  // 1. Đo hiện tại + ghi snapshot
  const nowIso = new Date().toISOString();
  const rows: Snapshot[] = [];
  for (const src of SOURCES) {
    const m = await countSource(src);
    rows.push({ captured_at: nowIso, source: src, ...m });
    console.log(`   ${src.padEnd(11)} ${m.touchpoints} tp · ${m.leads} lead · mới nhất ${m.last_event_at?.slice(0, 16) ?? "-"}`);
  }
  const { error: insErr } = await admin.from("data_health_snapshot").insert(
    rows.map((r) => ({ source: r.source, touchpoints: r.touchpoints, leads: r.leads, last_event_at: r.last_event_at }))
  );
  if (insErr) console.warn(`⚠️ ghi snapshot: ${insErr.message}`);

  // 2. Lấy lịch sử 7 ngày để so đỉnh
  const since = new Date(Date.now() - 8 * 86400_000).toISOString();
  const { data: hist } = await admin.from("data_health_snapshot")
    .select("captured_at, source, touchpoints, leads, last_event_at")
    .gte("captured_at", since)
    .order("captured_at", { ascending: false });
  const snapshots: Snapshot[] = (hist ?? []) as Snapshot[];

  const report = evaluateHealth(snapshots);
  console.log(`\n→ Tổng thể: ${report.overall.toUpperCase()}`);

  // 3. Quyết định gửi Lark
  const isProblem = report.overall !== "ok";
  const hourVN = (new Date().getUTCHours() + 7) % 24;
  const isHeartbeat = hourVN === HEARTBEAT_HOUR_VN;
  if (isProblem || isHeartbeat) {
    await sendLark(reportToLarkText(report));
  } else {
    console.log("(khỏe + không phải giờ heartbeat → không gửi Lark)");
  }

  // 4. Dọn snapshot > 30 ngày
  await admin.from("data_health_snapshot")
    .delete().lt("captured_at", new Date(Date.now() - 30 * 86400_000).toISOString());

  console.log("✨ Health check xong");
}
main().catch((e) => { console.error("❌", e); process.exit(1); });
