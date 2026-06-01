import { randomUUID } from "crypto";
import { admin } from "../lib/supabase-admin";
import { faker } from "../lib/faker";
import { resolveIdentity, logMatches } from "../lib/identity";

type EmailEvent = {
  id: string;
  email: string;
  subject: string;
  opened_at: string | null;
  clicked_at: string | null;
};

const SUBJECTS = [
  "Lộ trình Data Analyst từ 0 → có việc",
  "Tài liệu mẫu khóa Power BI [Bonus]",
  "Ưu đãi học viên cũ: giảm 20% khóa nâng cao",
  "Case study: chuyển ngành sau 6 tháng học",
  "Mời tham gia webinar miễn phí — SQL cho người mới",
  "Lịch khóa tháng 6 sắp đầy, còn 3 chỗ cuối",
  "Demo lớp tối — đăng ký ngay",
  "Bảng giá tổng hợp các khóa Data 2026",
  "Tài liệu: 10 dashboard mẫu Power BI",
  "Roadmap Data Engineer 12 tháng",
];

export async function pullFromInstantlySimulator() {
  console.log("📡 [Instantly] Đang gọi API simulator...");

  // 1. Log sync_job
  const { data: jobData, error: jobErr } = await admin
    .from("sync_job")
    .insert({ source: "instantly", status: "running", records_in: 0, records_merged: 0 })
    .select()
    .single();
  if (jobErr) throw new Error(`Tạo sync_job: ${jobErr.message}`);
  const jobId = jobData.id;

  // 2. Lấy email leads
  const { data: leads } = await admin.from("dim_lead").select("email").limit(20);
  const emails = leads?.map((l) => l.email).filter(Boolean) as string[];

  // 3. Generate 12-20 email events trong 48h qua
  const numEmails = faker.number.int({ min: 12, max: 20 });
  const events: EmailEvent[] = [];
  for (let i = 0; i < numEmails; i++) {
    const useExisting = emails.length > 0 && faker.number.float() < 0.85;
    const email = useExisting
      ? faker.helpers.arrayElement(emails)
      : `${faker.internet.username().toLowerCase()}@gmail.com`;

    const hoursAgo = faker.number.int({ min: 1, max: 48 });
    const openedAt = new Date(Date.now() - hoursAgo * 3600_000).toISOString();

    // 60% chỉ open, 35% open + click, 5% bounce/không open
    const status = faker.helpers.weightedArrayElement([
      { weight: 60, value: "opened" as const },
      { weight: 35, value: "clicked" as const },
      { weight: 5, value: "nothing" as const },
    ]);

    events.push({
      id: `inst-${randomUUID()}`,
      email,
      subject: faker.helpers.arrayElement(SUBJECTS),
      opened_at: status === "nothing" ? null : openedAt,
      clicked_at:
        status === "clicked"
          ? new Date(Date.now() - (hoursAgo - 0.5) * 3600_000).toISOString()
          : null,
    });
  }

  console.log(
    `📦 [Instantly] Pull được ${events.length} email events (${events.filter((e) => e.opened_at).length} open, ${events.filter((e) => e.clicked_at).length} click)`
  );

  // 4. Insert vào raw_instantly_emails
  const { error: rawErr } = await admin.from("raw_instantly_emails").insert(
    events.map((e) => ({
      id: e.id,
      lead_email: e.email,
      subject: e.subject,
      opened_at: e.opened_at,
      clicked_at: e.clicked_at,
      raw_data: { simulator: true },
    }))
  );
  if (rawErr) {
    await admin
      .from("sync_job")
      .update({ status: "failed", finished_at: new Date().toISOString(), error_message: rawErr.message })
      .eq("id", jobId);
    throw new Error(`Insert raw_instantly: ${rawErr.message}`);
  }

  // 5. Match identity qua email
  const matches = await resolveIdentity(
    events.map((e) => ({ id: e.id, email: e.email }))
  );
  logMatches(matches, "Instantly");

  // 6. Expand thành touchpoints (1 row raw có thể tạo 2 touchpoint: open + click)
  const matchMap = new Map(matches.map((m) => [m.rawId, m.leadId]));
  const touchpoints: Array<{
    lead_id: string;
    source: string;
    event_type: string;
    title: string;
    occurred_at: string;
    payload: Record<string, unknown>;
  }> = [];

  for (const e of events) {
    const leadId = matchMap.get(e.id);
    if (!leadId) continue;
    if (e.opened_at) {
      touchpoints.push({
        lead_id: leadId,
        source: "instantly",
        event_type: "email_open",
        title: `Mở email: ${e.subject}`,
        occurred_at: e.opened_at,
        payload: { subject: e.subject, raw_id: e.id },
      });
    }
    if (e.clicked_at) {
      touchpoints.push({
        lead_id: leadId,
        source: "instantly",
        event_type: "email_click",
        title: `Click email: ${e.subject}`,
        occurred_at: e.clicked_at,
        payload: { subject: e.subject, raw_id: e.id },
      });
    }
  }

  if (touchpoints.length > 0) {
    const { error } = await admin.from("fact_touchpoint").insert(touchpoints);
    if (error) {
      await admin
        .from("sync_job")
        .update({ status: "failed", finished_at: new Date().toISOString(), error_message: error.message })
        .eq("id", jobId);
      throw new Error(`Insert fact_touchpoint (Instantly): ${error.message}`);
    }
  }

  await admin
    .from("sync_job")
    .update({
      status: "success",
      finished_at: new Date().toISOString(),
      records_in: events.length,
      records_merged: touchpoints.length,
    })
    .eq("id", jobId);

  console.log(`✅ [Instantly] Insert ${touchpoints.length} fact_touchpoint`);
  return { inserted: touchpoints.length, jobId };
}
