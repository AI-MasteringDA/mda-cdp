import { NextRequest, NextResponse } from "next/server";
import { getAnalyticsClient } from "@/lib/supabase/analytics";

/**
 * Instantly webhook receiver.
 * Setup in Instantly: Settings → Integrations → Webhook
 * URL: https://mda-cdp.vercel.app/api/webhooks/instantly
 * Events to subscribe:
 *  - email_opened
 *  - email_clicked
 *  - email_replied
 *  - email_bounced
 *  - email_sent (optional — for MDA outbound tracking)
 */

type InstantlyEvent = {
  event_type?: string;
  campaign_id?: string;
  lead_email?: string;
  lead?: string;
  timestamp?: string;
  timestamp_email?: string;
  subject?: string;
  from_address_email?: string;
  message_id?: string;
  id?: string;
  ue_type?: number;
  [key: string]: unknown;
};

const EVENT_TYPE_MAP: Record<string, string> = {
  email_sent: "email_sent",
  email_opened: "email_open",
  email_clicked: "email_click",
  email_replied: "email_reply",
  email_bounced: "email_bounce",
  email_unsubscribed: "email_unsubscribe",
  // Fallbacks by ue_type
  "1": "email_sent",
  "2": "email_open",
  "3": "email_reply",
  "4": "email_click",
  "5": "email_bounce",
};

export async function POST(req: NextRequest) {
  try {
    // Secret check disabled for MVP — URL obscurity is enough for now.
    // To enable: set INSTANTLY_WEBHOOK_SECRET env + configure header in Instantly UI.

    const body = await req.json() as InstantlyEvent | InstantlyEvent[];
    const events = Array.isArray(body) ? body : [body];

    const admin = getAnalyticsClient();
    let inserted = 0;
    let skipped = 0;

    for (const ev of events) {
      const eventTypeRaw = ev.event_type || (ev.ue_type != null ? String(ev.ue_type) : "");
      const eventType = EVENT_TYPE_MAP[eventTypeRaw];
      if (!eventType) {
        skipped++;
        continue;
      }

      const leadEmail = (ev.lead_email || ev.lead || "").toString().toLowerCase().trim();
      if (!leadEmail) { skipped++; continue; }

      // Find lead by email
      let leadRow: { lead_id: string } | null = null;
      const { data: existingLead } = await admin
        .from("dim_lead").select("lead_id").eq("email", leadEmail).maybeSingle();
      leadRow = existingLead;

      if (!leadRow) {
        // Auto-create lead if not exists (webhook can be first touch)
        const { data: newLead, error: createErr } = await admin
          .from("dim_lead")
          .insert({ email: leadEmail, source: "instantly", stage: "Mới" })
          .select("lead_id").single();
        if (createErr || !newLead) { skipped++; continue; }
        leadRow = newLead;
      }

      const rawId = ev.id || ev.message_id || `${leadEmail}::${ev.timestamp}::${eventType}`;
      const occurredAt = ev.timestamp || ev.timestamp_email || new Date().toISOString();

      // Dedup: check if already exists
      const { data: existing } = await admin
        .from("fact_touchpoint")
        .select("id")
        .eq("source", "instantly")
        .eq("lead_id", leadRow.lead_id)
        .filter("payload->>raw_id", "eq", rawId)
        .limit(1)
        .maybeSingle();

      if (existing) { skipped++; continue; }

      // Determine title
      const subject = ev.subject || "(no subject)";
      const titles: Record<string, string> = {
        email_sent: `Đã gửi email: ${subject}`,
        email_open: `Đã mở email: ${subject}`,
        email_click: `Đã click link: ${subject}`,
        email_reply: `Phản hồi email: ${subject}`,
        email_bounce: `Email bounced: ${subject}`,
        email_unsubscribe: `Hủy nhận email: ${subject}`,
      };

      const { error: insertErr } = await admin.from("fact_touchpoint").insert({
        lead_id: leadRow.lead_id,
        source: "instantly",
        event_type: eventType,
        title: titles[eventType],
        occurred_at: occurredAt,
        payload: {
          raw_id: rawId,
          subject,
          from: ev.from_address_email,
          campaign_id: ev.campaign_id,
          event_type: eventTypeRaw,
          real: true,
          via: "webhook",
        },
      });

      if (insertErr) {
        console.error(`Webhook insert error: ${insertErr.message}`);
        skipped++;
      } else {
        inserted++;
      }
    }

    return NextResponse.json({ inserted, skipped, total: events.length });
  } catch (err) {
    console.error("Instantly webhook error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// Instantly may probe with GET for URL verification
export async function GET() {
  return NextResponse.json({ ok: true, service: "MDA CDP Instantly webhook" });
}
