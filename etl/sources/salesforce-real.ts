import { admin } from "../lib/supabase-admin";
import { batchResolveOrCreate, logMatches } from "../lib/identity";

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
  cachedExpire = Date.now() + 25 * 60_000;
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
  Account?: { Name: string | null } | null;
  OwnerId: string | null;
  Owner?: { Name: string | null } | null;
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
  Owner?: { Name: string | null } | null;
  CreatedDate: string;
};

type SfOpportunity = {
  Id: string;
  Name: string | null;
  StageName: string | null;
  Amount: number | null;
  CloseDate: string | null;
  AccountId: string | null;
  Account?: { Name: string | null } | null;
  Owner?: { Name: string | null } | null;
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
  Owner?: { Name: string | null } | null;
};

async function updateLeadMetadata(
  matches: Array<{ rawId: string; leadId: string | null }>,
  metaMap: Map<string, { company?: string; assignee?: string; leadSource?: string }>
) {
  const BATCH = 50;
  for (let i = 0; i < matches.length; i += BATCH) {
    const batch = matches.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (m) => {
        if (!m.leadId) return;
        const meta = metaMap.get(m.rawId);
        if (!meta || (!meta.company && !meta.assignee && !meta.leadSource)) return;
        const update: Record<string, string> = {};
        if (meta.company) update.company = sanitize(meta.company);
        if (meta.assignee) update.assignee = sanitize(meta.assignee);
        if (meta.leadSource) update.lead_source = sanitize(meta.leadSource);
        await admin.from("dim_lead").update(update).eq("lead_id", m.leadId);
      })
    );
  }
}

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

    // 1. Contacts
    console.log("📋 Pulling Contacts (with Owner.Name, Account.Name)...");
    const contactSql = `
      SELECT Id, Name, Email, Phone, MobilePhone, AccountId, Account.Name,
             OwnerId, Owner.Name, CreatedDate, LastModifiedDate, LeadSource
      FROM Contact
      WHERE Email != null OR Phone != null
      ORDER BY LastModifiedDate DESC
      LIMIT 10000
    `.replace(/\s+/g, " ").trim();
    const contacts = await sfQuery<SfContact>(contactSql);
    console.log(`   ↳ ${contacts.length} contacts pulled`);

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

    const whoIdToLeadId = new Map<string, string>();
    for (const m of contactMatches) {
      if (m.leadId) whoIdToLeadId.set(m.rawId, m.leadId);
    }

    // Update metadata
    const contactMeta = new Map<string, { company?: string; assignee?: string; leadSource?: string }>();
    for (const c of contacts) {
      contactMeta.set(c.Id, {
        company: c.Account?.Name || undefined,
        assignee: c.Owner?.Name || undefined,
        leadSource: c.LeadSource || undefined,
      });
    }
    await updateLeadMetadata(contactMatches, contactMeta);
    console.log(`   ↳ Updated metadata (company/assignee/lead_source) cho contacts`);

    // 2. Leads
    console.log("📋 Pulling Leads (with Owner.Name)...");
    const leadSql = `
      SELECT Id, Name, Email, Phone, Company, Status, LeadSource, Owner.Name, CreatedDate
      FROM Lead
      WHERE (Email != null OR Phone != null) AND IsConverted = false
      ORDER BY CreatedDate DESC
      LIMIT 10000
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

    for (const m of leadMatches) {
      if (m.leadId) whoIdToLeadId.set(m.rawId, m.leadId);
    }

    const leadMeta = new Map<string, { company?: string; assignee?: string; leadSource?: string }>();
    for (const l of leads) {
      leadMeta.set(l.Id, {
        company: l.Company || undefined,
        assignee: l.Owner?.Name || undefined,
        leadSource: l.LeadSource || undefined,
      });
    }
    await updateLeadMetadata(leadMatches, leadMeta);
    console.log(`   ↳ Updated metadata cho leads`);

    // 3. Insert "Lead Created" touchpoint cho lead mới pull về (skip nếu đã có)
    const allLeadIds = [
      ...contactMatches.map((m) => m.leadId),
      ...leadMatches.map((m) => m.leadId),
    ].filter(Boolean) as string[];

    const { data: alreadyCreated } = await admin
      .from("fact_touchpoint")
      .select("lead_id")
      .eq("event_type", "lead_created")
      .in("lead_id", allLeadIds);
    const hasCreated = new Set((alreadyCreated || []).map((r) => r.lead_id));

    const leadCreatedTouchpoints: Array<{
      lead_id: string;
      source: string;
      event_type: string;
      title: string;
      detail: string | null;
      occurred_at: string;
      payload: Record<string, unknown>;
    }> = [];

    for (const c of contacts) {
      const leadId = whoIdToLeadId.get(c.Id);
      if (!leadId || hasCreated.has(leadId)) continue;
      hasCreated.add(leadId);
      const owner = c.Owner?.Name || "Unassigned";
      const lsource = c.LeadSource || "Salesforce Contact";
      leadCreatedTouchpoints.push({
        lead_id: leadId,
        source: "salesforce",
        event_type: "lead_created",
        title: `🚪 Tạo Contact trong Salesforce`,
        detail: `Source: ${sanitize(lsource)} · Owner: ${sanitize(owner)}`,
        occurred_at: c.CreatedDate,
        payload: {
          sf_contact_id: c.Id,
          lead_source: sanitize(lsource),
          owner: sanitize(owner),
          real: true,
        },
      });
    }
    for (const l of leads) {
      const leadId = whoIdToLeadId.get(l.Id);
      if (!leadId || hasCreated.has(leadId)) continue;
      hasCreated.add(leadId);
      const owner = l.Owner?.Name || "Unassigned";
      const lsource = l.LeadSource || "Salesforce Lead";
      leadCreatedTouchpoints.push({
        lead_id: leadId,
        source: "salesforce",
        event_type: "lead_created",
        title: `🚪 Tạo Lead trong Salesforce`,
        detail: `Source: ${sanitize(lsource)} · Owner: ${sanitize(owner)} · Status: ${sanitize(l.Status || "?")}`,
        occurred_at: l.CreatedDate,
        payload: {
          sf_lead_id: l.Id,
          lead_source: sanitize(lsource),
          owner: sanitize(owner),
          status: sanitize(l.Status),
          real: true,
        },
      });
    }
    console.log(`   ↳ ${leadCreatedTouchpoints.length} "Lead Created" touchpoints mới`);

    // 4. Opportunities — Closed Won + Closed Lost + active stages
    console.log("📋 Pulling Opportunities (Won + Lost + active)...");
    const oppSql = `
      SELECT Id, Name, StageName, Amount, CloseDate, AccountId, Account.Name,
             Owner.Name, CreatedDate, LastModifiedDate
      FROM Opportunity
      WHERE StageName IN ('Closed Won', 'Closed Lost', 'Negotiation', 'BANT Analysis', 'Created')
      ORDER BY LastModifiedDate DESC
      LIMIT 10000
    `.replace(/\s+/g, " ").trim();
    const opps = await sfQuery<SfOpportunity>(oppSql);
    const wonCount = opps.filter((o) => o.StageName === "Closed Won").length;
    const lostCount = opps.filter((o) => o.StageName === "Closed Lost").length;
    console.log(`   ↳ ${opps.length} opportunities (${wonCount} Won, ${lostCount} Lost)`);

    // Pull Opportunity-Contact relationships — batch IN clause để pull cho TẤT CẢ opps
    console.log("📋 Pulling Opportunity-Contact relationships (batched)...");
    const oppContacts: Array<{ OpportunityId: string; ContactId: string; IsPrimary: boolean; Role: string }> = [];
    const IN_BATCH = 200;
    for (let i = 0; i < opps.length; i += IN_BATCH) {
      const batch = opps.slice(i, i + IN_BATCH);
      const sql = `
        SELECT OpportunityId, ContactId, IsPrimary, Role
        FROM OpportunityContactRole
        WHERE OpportunityId IN (${batch.map((o) => `'${o.Id}'`).join(",")})
      `.replace(/\s+/g, " ").trim();
      const partial = await sfQuery<{ OpportunityId: string; ContactId: string; IsPrimary: boolean; Role: string }>(sql);
      oppContacts.push(...partial);
    }
    console.log(`   ↳ ${oppContacts.length} opp-contact relationships (từ ${opps.length} opps)`);

    // Mark dim_lead.stage based on opportunity outcome
    const wonOppIds = new Set(opps.filter((o) => o.StageName === "Closed Won").map((o) => o.Id));
    const lostOppIds = new Set(opps.filter((o) => o.StageName === "Closed Lost").map((o) => o.Id));
    const wonLeadIds: string[] = [];
    const lostLeadIds: string[] = [];
    for (const oc of oppContacts) {
      const leadId = whoIdToLeadId.get(oc.ContactId);
      if (!leadId) continue;
      if (wonOppIds.has(oc.OpportunityId)) wonLeadIds.push(leadId);
      else if (lostOppIds.has(oc.OpportunityId)) lostLeadIds.push(leadId);
    }
    const uniqueWonLeads = [...new Set(wonLeadIds)];

    if (uniqueWonLeads.length > 0) {
      console.log(`   ↳ Marking ${uniqueWonLeads.length} dim_lead as "Đã chốt"...`);
      const BATCH = 100;
      let updated = 0;
      let updateFailed = 0;
      for (let i = 0; i < uniqueWonLeads.length; i += BATCH) {
        const batch = uniqueWonLeads.slice(i, i + BATCH);
        const { error, count } = await admin
          .from("dim_lead")
          .update({ stage: "Đã chốt" }, { count: "exact" })
          .in("lead_id", batch);
        if (error) {
          console.warn(`   ⚠️ Update batch ${i}: ${error.message}`);
          updateFailed += batch.length;
        } else {
          updated += count ?? 0;
        }
      }
      console.log(`   ↳ Updated ${updated} rows, ${updateFailed} failed`);
    }

    // 5. Tasks
    console.log("📋 Pulling Tasks...");
    const taskSql = `
      SELECT Id, Subject, WhoId, WhatId, Status, Priority,
             ActivityDate, CallDurationInSeconds, Description,
             CreatedDate, TaskSubtype, Owner.Name
      FROM Task
      WHERE WhoId != null AND CreatedDate = LAST_N_DAYS:30
      ORDER BY CreatedDate DESC
      LIMIT 10000
    `.replace(/\s+/g, " ").trim();
    const tasks = await sfQuery<SfTask>(taskSql);
    console.log(`   ↳ ${tasks.length} tasks pulled`);

    const taskTouchpoints: typeof leadCreatedTouchpoints = [];
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

      const ownerName = task.Owner?.Name || "TVV";
      taskTouchpoints.push({
        lead_id: leadId,
        source: "salesforce",
        event_type: eventType,
        title: `${sanitize(ownerName)}: ${sanitize(task.Subject || `(${subtype})`)}`.slice(0, 200),
        detail: sanitize(task.Description),
        occurred_at: task.ActivityDate
          ? new Date(task.ActivityDate).toISOString()
          : task.CreatedDate,
        payload: {
          task_id: sanitize(task.Id),
          subtype: sanitize(subtype),
          status: sanitize(task.Status),
          duration_sec: task.CallDurationInSeconds,
          owner: sanitize(ownerName),
          real: true,
        },
      });
    }

    // 6. Conversion + Lost touchpoints
    const oppTouchpoints: typeof leadCreatedTouchpoints = [];
    for (const opp of opps) {
      if (opp.StageName !== "Closed Won" && opp.StageName !== "Closed Lost") continue;
      const associatedContacts = oppContacts.filter((oc) => oc.OpportunityId === opp.Id);
      for (const oc of associatedContacts) {
        const leadId = whoIdToLeadId.get(oc.ContactId);
        if (!leadId) continue;
        const isWon = opp.StageName === "Closed Won";
        const ownerName = opp.Owner?.Name || "TVV";
        oppTouchpoints.push({
          lead_id: leadId,
          source: "salesforce",
          event_type: isWon ? "conversion" : "lost",
          title: isWon
            ? `🎓 Đã đăng ký: ${sanitize(opp.Name || "").slice(0, 130)}`
            : `❌ Mất khách: ${sanitize(opp.Name || "").slice(0, 130)}`,
          detail: `Stage: ${opp.StageName} · Amount: ${opp.Amount?.toLocaleString("vi-VN") || "?"} · TVV: ${sanitize(ownerName)}`,
          occurred_at: opp.CloseDate ? new Date(opp.CloseDate).toISOString() : opp.CreatedDate,
          payload: {
            opportunity_id: opp.Id,
            stage: opp.StageName,
            amount: opp.Amount,
            owner: sanitize(ownerName),
            real: true,
          },
        });
      }
    }

    const allTouchpoints = [...leadCreatedTouchpoints, ...taskTouchpoints, ...oppTouchpoints];
    console.log(`📦 [Salesforce] Touchpoints: ${allTouchpoints.length} (${leadCreatedTouchpoints.length} created + ${taskTouchpoints.length} tasks + ${oppTouchpoints.length} won/lost)`);

    // Dedupe by source-specific ID — PAGINATED (was bug: default 1000 row cap
    // meant only first 1000 SF rows were checked → all subsequent runs inserted
    // duplicates. Fixed by paginating through ALL rows.)
    console.log("   ↳ Loading existing SF IDs for dedupe (paginated)...");
    const existingIds = new Set<string>();
    let fromRow = 0;
    while (true) {
      const { data, error } = await admin
        .from("fact_touchpoint")
        .select("payload")
        .eq("source", "salesforce")
        .range(fromRow, fromRow + 999);
      if (error || !data || data.length === 0) break;
      for (const e of data) {
        const p = e.payload as Record<string, unknown>;
        const id = (p?.task_id as string) || (p?.opportunity_id as string) ||
                   (p?.sf_contact_id as string) || (p?.sf_lead_id as string);
        if (id) existingIds.add(id);
      }
      if (data.length < 1000) break;
      fromRow += 1000;
    }
    console.log(`   ↳ Cached ${existingIds.size} existing SF IDs`);

    const newTouchpoints = allTouchpoints.filter((t) => {
      const id = (t.payload.task_id as string) || (t.payload.opportunity_id as string) ||
                 (t.payload.sf_contact_id as string) || (t.payload.sf_lead_id as string);
      return !existingIds.has(id);
    });
    const skipped = allTouchpoints.length - newTouchpoints.length;
    if (skipped > 0) console.log(`   ↳ Skip ${skipped} đã tồn tại`);

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
    if (failed > 0) console.log(`   ⚠️ ${failed} touchpoint skip do lỗi`);

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
    console.log(`   ↳ ${uniqueWonLeads.length} dim_lead marked "Đã chốt"`);

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
