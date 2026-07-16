import { NextResponse, type NextRequest } from "next/server";
import { admin } from "@/etl/lib/supabase-admin";
import { batchResolveOrCreate } from "@/etl/lib/identity";

export const dynamic = "force-dynamic";

/**
 * Wix Automations webhook receiver — thay polling 6h bằng đẩy tức thời.
 *
 * Setup: Wix Dashboard → Automations → Create automation
 *   Trigger: "Contact created" / "Form submitted" / "New site member"
 *   Action: "Trigger a webhook (Make a call to your external service)"
 *   URL:    https://mda-cdp.vercel.app/api/webhooks/wix?secret=<WIX_WEBHOOK_SECRET>
 *   Method: POST
 *   Body (tự soạn trong Wix Automations, dùng {{...}} để chèn field động):
 *     {
 *       "event": "lead_created" | "form_submit" | "member_signup",
 *       "email": "{{contact.email}}",
 *       "phone": "{{contact.phone}}",
 *       "name": "{{contact.name.first}} {{contact.name.last}}",
 *       "occurred_at": "{{trigger.timestamp}}",
 *       "form_name": "{{form.name}}",       // chỉ cần khi event = form_submit
 *       "record_id": "{{contact.id}}"       // dùng để chống trùng (idempotency)
 *     }
 *
 * Set WIX_WEBHOOK_SECRET trong Vercel env vars khớp với ?secret= ở trên.
 */

type WixWebhookPayload = {
  event?: string;
  email?: string;
  phone?: string;
  name?: string;
  occurred_at?: string;
  form_name?: string;
  record_id?: string;
};

const EVENT_MAP: Record<string, string> = {
  lead_created: "lead_created",
  contact_created: "lead_created",
  member_signup: "lead_created",
  form_submit: "form_submit",
  form_submitted: "form_submit",
};

function eventTitle(type: string, formName?: string): string {
  switch (type) {
    case "lead_created": return "🌐 Contact/Member mới trên Wix";
    case "form_submit":  return `📝 Submit form${formName ? `: ${formName}` : ""} trên website MDA`;
    default:              return "🌐 Wix event";
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const providedSecret = searchParams.get("secret")?.trim();
  const expectedSecret = process.env.WIX_WEBHOOK_SECRET?.trim();
  if (expectedSecret && providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: WixWebhookPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = EVENT_MAP[(payload.event || "").toLowerCase()];
  if (!eventType) {
    // 200 để Wix Automations không coi là lỗi và retry vô hạn
    return NextResponse.json(
      { error: `Unknown event: ${payload.event}`, supported: Object.keys(EVENT_MAP) },
      { status: 200 }
    );
  }

  const email = (payload.email || "").toLowerCase().trim();
  const phone = (payload.phone || "").trim();
  if (!email && !phone) {
    return NextResponse.json({ error: "Missing email/phone" }, { status: 400 });
  }

  const seedId = payload.record_id ? `wix_wh_${payload.record_id}` : `wix_wh_${Date.now()}`;
  const matches = await batchResolveOrCreate(
    [{ id: seedId, email: email || undefined, phone: phone || undefined, name: payload.name }],
    { source: "web" }
  );
  const leadId = matches[0]?.leadId;
  if (!leadId) {
    return NextResponse.json({ error: "Could not resolve lead" }, { status: 500 });
  }

  const occurredAt = payload.occurred_at || new Date().toISOString();
  const rawId = payload.record_id
    ? `${payload.record_id}_${eventType}`
    : `${email || phone}_${eventType}_${occurredAt}`;

  const { data: existing } = await admin
    .from("fact_touchpoint")
    .select("id")
    .eq("source", "web")
    .filter("payload->>raw_id", "eq", rawId)
    .limit(1)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true, skipped: "already_recorded", lead_id: leadId });
  }

  const { error } = await admin.from("fact_touchpoint").insert({
    lead_id: leadId,
    source: "web",
    event_type: eventType,
    title: eventTitle(eventType, payload.form_name),
    detail: payload.form_name || null,
    occurred_at: occurredAt,
    payload: { raw_id: rawId, record_id: payload.record_id, form_name: payload.form_name, via: "webhook" },
  });
  if (error) {
    return NextResponse.json({ error: `Insert failed: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, lead_id: leadId, event_type: eventType, occurred_at: occurredAt });
}

// Wix Automations có thể ping GET để kiểm tra URL sống trước khi lưu automation
export async function GET() {
  return NextResponse.json({ status: "ok", service: "wix_webhook", accepts: Object.keys(EVENT_MAP) });
}
