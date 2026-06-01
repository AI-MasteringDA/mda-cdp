import { randomUUID } from "crypto";
import { admin } from "../lib/supabase-admin";
import { faker, fakeChatMessage } from "../lib/faker";
import { resolveIdentity, logMatches } from "../lib/identity";

export type SmaxChat = {
  id: string;
  user_phone: string;
  message: string;
  direction: "inbound" | "outbound";
  occurred_at: string;
};

export async function pullFromSmaxSimulator() {
  console.log("📡 [SMAX] Đang gọi API simulator...");

  const { data: jobData, error: jobErr } = await admin
    .from("sync_job")
    .insert({ source: "smax", status: "running", records_in: 0, records_merged: 0 })
    .select()
    .single();
  if (jobErr) throw new Error(`Tạo sync_job: ${jobErr.message}`);
  const jobId = jobData.id;

  const { data: leads } = await admin.from("dim_lead").select("phone").limit(20);
  const phones = leads?.map((l) => l.phone).filter(Boolean) as string[];

  const numChats = faker.number.int({ min: 8, max: 15 });
  const chats: SmaxChat[] = [];
  for (let i = 0; i < numChats; i++) {
    const useExisting = phones.length > 0 && faker.number.float() < 0.6;
    const phone = useExisting
      ? faker.helpers.arrayElement(phones)
      : `+84 9${faker.string.numeric(8)}`;
    chats.push({
      id: `smax-${randomUUID()}`,
      user_phone: phone,
      message: fakeChatMessage(),
      direction: faker.helpers.arrayElement(["inbound", "outbound"]),
      occurred_at: new Date(
        Date.now() - faker.number.int({ min: 1, max: 24 }) * 3600_000
      ).toISOString(),
    });
  }

  console.log(`📦 [SMAX] Pull được ${chats.length} chats`);

  // Insert raw
  const { error: rawErr } = await admin.from("raw_smax_chats").insert(
    chats.map((c) => ({
      id: c.id,
      user_phone: c.user_phone,
      message: c.message,
      direction: c.direction,
      occurred_at: c.occurred_at,
      raw_data: { simulator: true },
    }))
  );
  if (rawErr) {
    await admin
      .from("sync_job")
      .update({ status: "failed", finished_at: new Date().toISOString(), error_message: rawErr.message })
      .eq("id", jobId);
    throw new Error(`Insert raw_smax: ${rawErr.message}`);
  }

  // Match identity qua phone
  const matches = await resolveIdentity(
    chats.map((c) => ({ id: c.id, phone: c.user_phone }))
  );
  logMatches(matches, "SMAX");

  // Insert touchpoints
  const matchMap = new Map(matches.map((m) => [m.rawId, m.leadId]));
  const touchpoints = chats
    .filter((c) => matchMap.get(c.id))
    .map((c) => ({
      lead_id: matchMap.get(c.id)!,
      source: "smax",
      event_type: "chat",
      title: `Chat: ${c.message.slice(0, 60)}${c.message.length > 60 ? "..." : ""}`,
      detail: c.message,
      occurred_at: c.occurred_at,
      payload: { direction: c.direction, raw_id: c.id },
    }));

  if (touchpoints.length > 0) {
    const { error } = await admin.from("fact_touchpoint").insert(touchpoints);
    if (error) {
      await admin
        .from("sync_job")
        .update({ status: "failed", finished_at: new Date().toISOString(), error_message: error.message })
        .eq("id", jobId);
      throw new Error(`Insert fact_touchpoint (SMAX): ${error.message}`);
    }
  }

  await admin
    .from("sync_job")
    .update({
      status: "success",
      finished_at: new Date().toISOString(),
      records_in: chats.length,
      records_merged: touchpoints.length,
    })
    .eq("id", jobId);

  console.log(`✅ [SMAX] Insert ${touchpoints.length} fact_touchpoint`);
  return { inserted: touchpoints.length, jobId };
}
