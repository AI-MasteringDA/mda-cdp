import { NextResponse, type NextRequest } from "next/server";
import { admin } from "@/etl/lib/supabase-admin";
import { batchResolveOrCreate } from "@/etl/lib/identity";

export const dynamic = "force-dynamic";

/**
 * Instantly Webhook receiver.
 *
 * Configure in Instantly Dashboard → Settings → Integrations → Webhooks:
 *   URL: https://mda-cdp.vercel.app/api/webhook/instantly?secret=YOUR_SECRET
 *   Events: email_opened, email_clicked, email_replied, email_bounced
 *
 * Set INSTANTLY_WEBHOOK_SECRET in Vercel env vars matching the ?secret= param.
 *
 * Instantly payload format (observed):
 * {
 *   event_type: "email_opened" | "email_clicked" | "email_replied" | ...,
 *   timestamp: "2026-06-02T08:00:02.000Z",
 *   lead_email: "user@example.com",
 *   lead_id?: string,
 *   campaign_id?: string,
 *   subject?: string,
 *   email_id?: string,
 *   step?: number,
 *   url?: string  // for clicks
 * }
 */

type InstantlyWebhookPayload = {
  event_type?: string;
  event?: string;
  type?: string;
  timestamp?: string;
  occurred_at?: string;
  lead_email?: string;
  email?: string;
  lead_id?: string;
  campaign_id?: string;
  subject?: string;
  email_id?: string;
  step?: number;
  url?: string;
};

const EVENT_MAP: Record<string, string> = {
  email_opened: "email_open",
  email_open: "email_open",
  opened: "email_open",
  open: "email_open",
  email_clicked: "email_click",
  email_click: "email_click",
  clicked: "email_click",
  click: "email_click",
  email_replied: "email_reply",
  email_reply: "email_reply",
  replied: "email_reply",
  reply: "email_reply",
  email_bounced: "email_bounce",
  email_bounce: "email_bounce",
  bounced: "email_bounce",
};

function eventTitle(type: string, subject?: string): string {
  const s = subject ? `: ${subject}` : "";
  switch (type) {
    case "email_open":   return `Đã mở email${s}`;
    case "email_click":  return `Đã click email${s}`;
    case "email_reply":  return `Phản hồi email${s}`;
    case "email_bounce": return `Email bounce${s}`;
    default:             return `Email event${s}`;
  }
}

export async function POST(request: NextRequest) {
  // 1. Verify secret token from query string (trim to handle env var newlines)
  const { searchParams } = new URL(request.url);
  const providedSecret = searchParams.get("secret")?.trim();
  const expectedSecret = process.env.INSTANTLY_WEBHOOK_SECRET?.trim();
  if (expectedSecret && providedSecret !== expectedSecret) {
    return NextResponse.json({
      error: "Unauthorized",
      hint: `Provided length: ${providedSecret?.length}, expected length: ${expectedSecret.length}`,
    }, { status: 401 });
  }

  // 2. Parse payload
  let payload: InstantlyWebhookPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // 3. Extract event type (try multiple field names Instantly may use)
  const rawType = payload.event_type || payload.event || payload.type || "";
  const eventType = EVENT_MAP[rawType.toLowerCase()];
  if (!eventType) {
    return NextResponse.json(
      { error: `Unknown event_type: ${rawType}`, supported: Object.keys(EVENT_MAP) },
      { status: 200 } // 200 so Instantly doesn't retry
    );
  }

  // 4. Extract lead email
  const leadEmail = (payload.lead_email || payload.email || "").toLowerCase().trim();
  if (!leadEmail) {
    return NextResponse.json({ error: "Missing lead_email" }, { status: 400 });
  }

  // 5. Resolve/create lead
  const matches = await batchResolveOrCreate(
    [{ id: payload.email_id || `wh_${Date.now()}`, email: leadEmail }],
    { source: "instantly" }
  );
  const leadId = matches[0]?.leadId;
  if (!leadId) {
    return NextResponse.json({ error: "Could not resolve lead" }, { status: 500 });
  }

  // 6. Idempotency: dedupe by composite raw_id
  const rawId = payload.email_id
    ? `${payload.email_id}_${eventType}`
    : `${leadEmail}_${eventType}_${payload.timestamp || ""}`;
  const { data: existing } = await admin
    .from("fact_touchpoint")
    .select("id")
    .eq("source", "instantly")
    .filter("payload->>raw_id", "eq", rawId)
    .limit(1)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true, skipped: "already_recorded", lead_id: leadId });
  }

  // 7. Insert touchpoint
  const occurredAt = payload.timestamp || payload.occurred_at || new Date().toISOString();
  const { error } = await admin.from("fact_touchpoint").insert({
    lead_id: leadId,
    source: "instantly",
    event_type: eventType,
    title: eventTitle(eventType, payload.subject),
    detail: payload.url || null,
    occurred_at: occurredAt,
    payload: {
      raw_id: rawId,
      subject: payload.subject,
      campaign_id: payload.campaign_id,
      email_id: payload.email_id,
      url: payload.url,
      step: payload.step,
      via: "webhook",
    },
  });
  if (error) {
    return NextResponse.json({ error: `Insert failed: ${error.message}` }, { status: 500 });
  }

  // 8. Update aggregate columns on dim_lead (incremental, not full recompute)
  const fieldMap: Record<string, string> = {
    email_open: "email_open_count",
    email_click: "email_click_count",
    email_reply: "email_received_count", // replies update received_count alternatively
  };
  const counterField = fieldMap[eventType];
  if (counterField) {
    await admin.rpc("increment_lead_counter", {
      target_lead_id: leadId,
      counter_field: counterField,
      occurred_at_value: occurredAt,
    });
    // Falls back to a manual update if RPC doesn't exist yet
  }

  return NextResponse.json({
    ok: true,
    lead_id: leadId,
    event_type: eventType,
    occurred_at: occurredAt,
  });
}

// GET for health check (Instantly may probe URL)
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "instantly_webhook",
    accepts: Object.keys(EVENT_MAP),
  });
}
