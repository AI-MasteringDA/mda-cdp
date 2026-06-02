import { admin } from "../lib/supabase-admin";
import { batchResolveOrCreate, logMatches } from "../lib/identity";

/**
 * Salesforce REAL connector — Client Credentials Flow + REST API
 *
 * Pulls:
 *   1. Contacts → enrich/create dim_lead
 *   2. Leads → create dim_lead (prospects)
 *   3. Opportunities → mark dim_lead.stage = "Đã chốt" if Closed Won
 *   4. Tasks → fact_touchpoint (calls, meetings, notes)
 *
 * Token: cached in memory, refresh khi expire (Client Credentials token ~30 phút).
 */

const INSTANCE = process.env.SALESFORCE_INSTANCE_URL!;
const CLIENT_ID = process.env.SALESFORCE_CLIENT_ID!;
const CLIENT_SECRET = process.env.SALESFORCE_CLIENT_SECRET!;
const API_VERSION = process.env.SALESFORCE_API_VERSION || "v59.0";

const NULL_BYTE = String.fromCharCode(0);
function sanitize(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .split(NULL_BYTE).join("")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

let cachedToken: string | null = null;
let cachedExpire = 0;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedExpire) return cachedToken;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });
  const res = await fetch(`${INSTANCE}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`SF token: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cachedToken = data.access_token as string;
  cachedExpire = Date.now() + 25 * 60_000; // 25 phút (token sống 30 phút)
  return cachedToken!;
}

async function sfQuery<T>(soql: string): Promise<T[]> {
  const token = await getToken();
  let url: string | null = `${INSTANCE}/services/data/${API_VERSION}/query?q=${encodeURIComponent(soql)}`;
  const records: T[] = [];

  while (url) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`SF query: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as {
      records: T[];
      done: boolean;
      nextRecordsUrl?: string;
    };
    records.push(...data.records);
    url = data.done ? null : (data.nextRecordsUrl ? `${INSTANCE}${data.nextRecordsUrl}` : null);
  }
  return records;
}

type SfContact = {
  Id: string;
  Name: string | null;
  Email: string | null;
  Phone: string | null;
  MobilePhone: string | null;
  AccountId: string | null;
  OwnerId: string | null;
  CreatedDate: string;
  LastModifiedDate: string;
  LeadSource?: string | null;
};

type SfLead = {
  Id: string;
  Name: string | null;
  Email: string | null;
  Phone: string | null;
  Company: string | null;
  Status: string | null;
  LeadSource: string | null;
  CreatedDate: string;
};

type SfOpportunity = {
  Id: string;
  Name: string | null;
  StageName: string | null;
  Amount: number | null;
  CloseDate: string | null;
  AccountId: string | null;
  CreatedDate: string;
  LastModifiedDate: string;
};

type SfTask = {
  Id: string;
  Subject: string | null;
  WhoId: string | null;
  WhatId: string | null;
  Status: string | null;
  Priority: string | null;
  ActivityDate: string | null;
  CallDurationInSeconds: number | null;
  Description: string | null;
  CreatedDate: string;
  TaskSubtype?: string | null;
};

export async function pullFromSalesforceReal() {
  console.log("📡 [Salesforce REAL] Đang gọi API thật...");

  const { data: jobData, error: jobErr } = await admin
    .from("sync_job")
    .insert({ source: "salesforce", status: "running", records_in: 0, records_merged: 0 })
    .select()
    .single();
  if (jobErr) throw new Error(`sync_job: ${jobErr.message}`);
  const jobId = jobData.id;

  try {
    let totalTouchpoints = 0;

    // 1. Contacts — pull recent (last 90 days)
    console.log("📋 Pulling Contacts...");
    const contactSql = `
      SELECT Id, Name, Email, Phone, MobilePhone, AccountId, OwnerId,
             CreatedDate, LastModifiedDate, LeadSource
      FROM Contact
      WHERE Email != null OR Phone != null
      ORDER BY LastModifiedDate DESC
      LIMIT 500
    `.replace(/\s+/g, " ").trim();
    const contacts = await sfQuery<SfContact>(contactSql);
    console.log(`   ↳ ${contacts.length} contacts pulled`);

    // Identity resolution + auto-create
    const contactMatches = await batchResolveOrCreate(
      contacts.map((c) => ({
        id: c.Id,
        email: c.Email,
        phone: c.Phone || c.MobilePhone,
        name: c.Name,
      })),
      { source: "salesforce" }
    );
    logMatches(contactMatches, "Salesforce Contacts");
    // Combined map: SF Contact.Id + Lead.Id → MDA lead_id
    const whoIdToLeadId = new Map<string, string>();
    for (const m of contactMatches) {
      if (m.leadId) whoIdToLeadId.set(m.rawId, m.leadId);
    }

    // 2. Leads — Salesforce Lead object
    console.log("📋 Pulling Leads...");
    const leadSql = `
      SELECT Id, Name, Email, Phone, Company, Status, LeadSource, CreatedDate
      FROM Lead
      WHERE (Email != null OR Phone != null) AND IsConverted = false
      ORDER BY CreatedDate DESC
      LIMIT 500
    `.replace(/\s+/g, " ").trim();
    const leads = await sfQuery<SfLead>(leadSql);
    console.log(`   ↳ ${leads.length} leads pulled`);

    const leadMatches = await batchResolveOrCreate(
      leads.map((l) => ({
        id: l.Id,
        email: l.Email,
        phone: l.Phone,
        name: l.Name,
      })),
      { source: "salesforce" }
    );
    logMatches(leadMatches, "Salesforce Leads");

    // Add Lead matches vào combined map (cho WhoId = Lead.Id)
    for (const m of leadMatches) {
      if (m.leadId) whoIdToLeadId.set(m.rawId, m.leadId);
    }

    // 3. Opportunities — focus on Closed Won (paying students)
    console.log("📋 Pulling Opportunities (Closed Won + recent active)...");
    const oppSql = `
      SELECT Id, Name, StageName, Amount, CloseDate, AccountId,
             CreatedDate, LastModifiedDate
      FROM Opportunity
      WHERE StageName IN ('Closed Won', 'Negotiation', 'BANT Analysis', 'Created')
      ORDER BY LastModifiedDate DESC
      LIMIT 500
    `.replace(/\s+/g, " ").trim();
    const opps = await sfQuery<SfOpportunity>(oppSql);
    const wonCount = opps.filter((o) => o.StageName === "Closed Won").length;
    console.log(`   ↳ ${opps.length} opportunities pulled (${wonCount} Closed Won)`);

    // Map Opportunity → Contact via OpportunityContactRole (need separate query)
    console.log("📋 Pulling Opportunity-Contact relationships...");
    const oppContactSql = `
      SELECT OpportunityId, ContactId, IsPrimary, Role
      FROM OpportunityContactRole
      WHERE OpportunityId IN (${opps.slice(0, 200).map((o) => `'${o.Id}'`).join(",")})
    `.replace(/\s+/g, " ").trim();
    const oppContacts = opps.length > 0
      ? await sfQuery<{ OpportunityId: string; ContactId: string; IsPrimary: boolean; Role: string }>(oppContactSql)
      : [];
    console.log(`   ↳ ${oppContacts.length} opp-contact relationships`);

    // Update dim_lead.stage = "Học viên" for Closed Won contacts
    const wonOppIds = new Set(opps.filter((o) => o.StageName === "Closed Won").map((o) => o.Id));
    const wonContactIds = new Set(
      oppContacts.filter((oc) => wonOppIds.has(oc.OpportunityId)).map((oc) => oc.ContactId)
    );
    const wonLeadIds: string[] = [];
    for (const contactId of wonContactIds) {
      const leadId = whoIdToLeadId.get(contactId);
      if (leadId) wonLeadIds.push(leadId);
    }

    if (wonLeadIds.length > 0) {
      console.log(`   ↳ Marking ${wonLeadIds.length} dim_lead as "Đã chốt"...`);
      // Batch update
      const BATCH = 100;
      for (let i = 0; i < wonLeadIds.length; i += BATCH) {
        const batch = wonLeadIds.slice(i, i + BATCH);
        await admin.from("dim_lead").update({ stage: "Đã chốt" }).in("lead_id", batch);
      }
    }

    // 4. Tasks — recent activities (calls, meetings, emails logged)
    console.log("📋 Pulling Tasks...");
    const taskSql = `
      SELECT Id, Subject, WhoId, WhatId, Status, Priority,
             ActivityDate, CallDurationInSeconds, Description,
             CreatedDate, TaskSubtype
      FROM Task
      WHERE WhoId != null AND CreatedDate = LAST_N_DAYS:90
      ORDER BY CreatedDate DESC
      LIMIT 500
    `.replace(/\s+/g, " ").trim();
    const tasks = await sfQuery<SfTask>(taskSql);
    console.log(`   ↳ ${tasks.length} tasks pulled`);

    // Build touchpoints from tasks
    const taskTouchpoints: Array<{
      lead_id: string;
      source: string;
      event_type: string;
      title: string;
      detail: string | null;
      occurred_at: string;
      payload: Record<string, unknown>;
    }> = [];

    for (const task of tasks) {
      if (!task.WhoId) continue;
      const leadId = whoIdToLeadId.get(task.WhoId);
      if (!leadId) continue;

      const subtype = task.TaskSubtype || "task";
      const eventType =
        subtype === "Call" ? "call"
        : subtype === "Email" ? "email_sent"
        : subtype === "Meeting" ? "meeting"
        : "note";

      taskTouchpoints.push({
        lead_id: leadId,
        source: "salesforce",
        event_type: eventType,
        title: sanitize(task.Subject || `(${subtype})`).slice(0, 200),
        detail: sanitize(task.Description),
        occurred_at: task.ActivityDate
          ? new Date(task.ActivityDate).toISOString()
          : task.CreatedDate,
        payload: {
          task_id: sanitize(task.Id),
          subtype: sanitize(subtype),
          status: sanitize(task.Status),
          duration_sec: task.CallDurationInSeconds,
          real: true,
        },
      });
    }

    // Build Opportunity Won touchpoints (conversion event)
    const oppTouchpoints: typeof taskTouchpoints = [];
    for (const opp of opps) {
      if (opp.StageName !== "Closed Won") continue;
      // Find contacts associated with this opp
      const associatedContacts = oppContacts.filter((oc) => oc.OpportunityId === opp.Id);
      for (const oc of associatedContacts) {
        const leadId = whoIdToLeadId.get(oc.ContactId);
        if (!leadId) continue;
        oppTouchpoints.push({
          lead_id: leadId,
          source: "salesforce",
          event_type: "conversion",
          title: `🎓 Đã đăng ký: ${sanitize(opp.Name || "").slice(0, 150)}`,
          detail: `Stage: ${opp.StageName} · Amount: ${opp.Amount?.toLocaleString("vi-VN") || "?"}`,
          occurred_at: opp.CloseDate ? new Date(opp.CloseDate).toISOString() : opp.CreatedDate,
          payload: {
            opportunity_id: opp.Id,
            stage: opp.StageName,
            amount: opp.Amount,
            real: true,
          },
        });
      }
    }

    const allTouchpoints = [...taskTouchpoints, ...oppTouchpoints];
    console.log(`📦 [Salesforce] Touchpoints to insert: ${allTouchpoints.length} (${taskTouchpoints.length} tasks + ${oppTouchpoints.length} conversions)`);

    // Dedupe by task_id / opportunity_id
    const { data: existing } = await admin
      .from("fact_touchpoint")
      .select("payload")
      .eq("source", "salesforce");
    const existingIds = new Set(
      (existing || [])
        .map((e) => {
          const p = e.payload as Record<string, unknown>;
          return (p?.task_id as string) || (p?.opportunity_id as string);
        })
        .filter(Boolean)
    );

    const newTouchpoints = allTouchpoints.filter((t) => {
      const id = (t.payload.task_id as string) || (t.payload.opportunity_id as string);
      return !existingIds.has(id);
    });
    const skipped = allTouchpoints.length - newTouchpoints.length;
    if (skipped > 0) console.log(`   ↳ Skip ${skipped} touchpoint đã tồn tại`);

    let inserted = 0;
    let failed = 0;
    const INSERT_BATCH = 100;
    for (let i = 0; i < newTouchpoints.length; i += INSERT_BATCH) {
      const batch = newTouchpoints.slice(i, i + INSERT_BATCH);
      const { error } = await admin.from("fact_touchpoint").insert(batch);
      if (error) {
        for (const tp of batch) {
          const { error: e } = await admin.from("fact_touchpoint").insert([tp]);
          if (!e) inserted++;
          else failed++;
        }
        continue;
      }
      inserted += batch.length;
    }
    if (failed > 0) console.log(`   ⚠️ ${failed} touchpoint skip do data lỗi`);

    totalTouchpoints = inserted;

    await admin
      .from("sync_job")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        records_in: contacts.length + leads.length + opps.length + tasks.length,
        records_merged: totalTouchpoints,
      })
      .eq("id", jobId);

    console.log(`✅ [Salesforce REAL] Insert ${totalTouchpoints} fact_touchpoint`);
    console.log(`   ↳ ${wonLeadIds.length} dim_lead marked "Đã chốt"`);

    return { inserted: totalTouchpoints, jobId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin
      .from("sync_job")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: msg.slice(0, 500),
      })
      .eq("id", jobId);
    throw e;
  }
}
