import { randomUUID } from "crypto";
import { admin } from "../lib/supabase-admin";
import { faker } from "../lib/faker";
import { resolveIdentity, logMatches } from "../lib/identity";

type CallEvent = {
  id: string;
  email: string;
  outcome: "talked" | "voicemail" | "no_answer" | "callback_scheduled";
  durationMin: number;
  occurredAt: string;
};

const OUTCOME_TITLES: Record<CallEvent["outcome"], string[]> = {
  talked: [
    "Tư vấn 1-1 chốt lịch học",
    "Tư vấn lộ trình - {min} phút",
    "Demo lớp tối - trao đổi yêu cầu",
    "Tư vấn so sánh khóa BI vs Data Science",
  ],
  voicemail: ["Để lại voicemail", "Gọi không bắt máy, để lại voicemail"],
  no_answer: ["Gọi không bắt máy", "Gọi 2 lần không phản hồi"],
  callback_scheduled: ["Lead xin gọi lại sau giờ làm", "Hẹn gọi lại ngày mai"],
};

export async function pullFromSalesforceSimulator() {
  console.log("📡 [Salesforce] Đang gọi API simulator...");

  // 1. Log sync_job
  const { data: jobData, error: jobErr } = await admin
    .from("sync_job")
    .insert({ source: "salesforce", status: "running", records_in: 0, records_merged: 0 })
    .select()
    .single();
  if (jobErr) throw new Error(`Tạo sync_job: ${jobErr.message}`);
  const jobId = jobData.id;

  // 2. Lấy email lead có sẵn để 90% gán vào lead cũ
  const { data: leads } = await admin.from("dim_lead").select("email").limit(20);
  const emails = leads?.map((l) => l.email).filter(Boolean) as string[];

  // 3. Generate 3-7 call events trong 48h qua
  const numCalls = faker.number.int({ min: 3, max: 7 });
  const calls: CallEvent[] = [];
  for (let i = 0; i < numCalls; i++) {
    const useExisting = emails.length > 0 && faker.number.float() < 0.9;
    const email = useExisting
      ? faker.helpers.arrayElement(emails)
      : `${faker.internet.username().toLowerCase()}@gmail.com`;

    const outcome = faker.helpers.weightedArrayElement([
      { weight: 4, value: "talked" as const },
      { weight: 3, value: "no_answer" as const },
      { weight: 2, value: "voicemail" as const },
      { weight: 1, value: "callback_scheduled" as const },
    ]);

    calls.push({
      id: `sf-call-${randomUUID()}`,
      email,
      outcome,
      durationMin: outcome === "talked" ? faker.number.int({ min: 3, max: 18 }) : 0,
      occurredAt: new Date(
        Date.now() - faker.number.int({ min: 1, max: 48 }) * 3600_000
      ).toISOString(),
    });
  }

  console.log(`📦 [Salesforce] Pull được ${calls.length} call events`);

  // 4. Identity match qua email
  const matches = await resolveIdentity(
    calls.map((c) => ({ id: c.id, email: c.email }))
  );
  logMatches(matches, "Salesforce");

  // 5. Insert fact_touchpoint cho call match được lead
  const matchMap = new Map(matches.map((m) => [m.rawId, m.leadId]));
  const touchpoints = calls
    .filter((c) => matchMap.get(c.id))
    .map((c) => {
      const titleTpl = faker.helpers.arrayElement(OUTCOME_TITLES[c.outcome]);
      const title = titleTpl.replace("{min}", c.durationMin.toString());
      return {
        lead_id: matchMap.get(c.id)!,
        source: "salesforce",
        event_type: "call",
        title,
        detail: c.outcome === "talked" ? `Cuộc gọi ${c.durationMin} phút` : null,
        occurred_at: c.occurredAt,
        payload: { outcome: c.outcome, duration_min: c.durationMin },
      };
    });

  if (touchpoints.length > 0) {
    const { error } = await admin.from("fact_touchpoint").insert(touchpoints);
    if (error) {
      await admin
        .from("sync_job")
        .update({ status: "failed", finished_at: new Date().toISOString(), error_message: error.message })
        .eq("id", jobId);
      throw new Error(`Insert fact_touchpoint (SF): ${error.message}`);
    }
  }

  // 6. Update sync_job
  await admin
    .from("sync_job")
    .update({
      status: "success",
      finished_at: new Date().toISOString(),
      records_in: calls.length,
      records_merged: touchpoints.length,
    })
    .eq("id", jobId);

  console.log(`✅ [Salesforce] Insert ${touchpoints.length} fact_touchpoint`);
  return { inserted: touchpoints.length, jobId };
}
