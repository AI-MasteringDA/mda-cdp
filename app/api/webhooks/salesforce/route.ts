import { NextResponse, type NextRequest } from "next/server";
import { admin } from "@/etl/lib/supabase-admin";
import { batchResolveOrCreate } from "@/etl/lib/identity";

export const dynamic = "force-dynamic";

/**
 * Salesforce webhook receiver — bổ sung tín hiệu GẦN TỨC THỜI bên cạnh
 * polling định kỳ (salesforce-real.ts), KHÔNG thay thế nó: webhook chỉ ghi
 * touchpoint (sự kiện "vừa xảy ra"), còn dim_lead.sf_rating/sf_status/... vẫn
 * do lần poll đầy đủ tiếp theo cập nhật — nên dữ liệu không bao giờ cũ hơn
 * hiện trạng, chỉ là "biết sớm hơn" khi có event.
 *
 * Setup phía Salesforce (Setup → Flows → New Flow → Record-Triggered Flow):
 *   Object: Lead (hoặc Opportunity)
 *   Trigger: A record is created or updated
 *   Action:  HTTP Callout (Flow Builder → New Resource → External Service,
 *            hoặc dùng "Action - Call REST API" nếu org có sẵn)
 *   URL:     https://mda-cdp.vercel.app/api/webhooks/salesforce?secret=<SF_WEBHOOK_SECRET>
 *   Method:  POST
 *   Body:
 *     {
 *       "event": "lead_created" | "rating_changed" | "status_changed" | "opportunity_won",
 *       "sf_id": "{!$Record.Id}",
 *       "email": "{!$Record.Email}",
 *       "phone": "{!$Record.Phone}",
 *       "name": "{!$Record.Name}",
 *       "rating": "{!$Record.Rating}",
 *       "status": "{!$Record.Status}",
 *       "product": "{!$Record.Product__c}",
 *       "occurred_at": "{!$Flow.CurrentDateTime}"
 *     }
 *
 * Set SALESFORCE_WEBHOOK_SECRET trong Vercel env vars khớp ?secret= ở trên.
 */

type SfWebhookPayload = {
  event?: string;
  sf_id?: string;
  email?: string;
  phone?: string;
  name?: string;
  rating?: string;
  status?: string;
  product?: string;
  occurred_at?: string;
};

const EVENT_MAP: Record<string, string> = {
  lead_created: "lead_created",
  rating_changed: "note",
  status_changed: "note",
  opportunity_won: "conversion",
};

function eventTitle(type: string, p: SfWebhookPayload): string {
  switch (p.event) {
    case "lead_created":      return "🔔 Lead mới trên Salesforce";
    case "rating_changed":    return `⭐ SF Rating đổi thành: ${p.rating || "?"}`;
    case "status_changed":    return `🔄 SF Status đổi thành: ${p.status || "?"}`;
    case "opportunity_won":   return `🏆 Chốt deal${p.product ? `: ${p.product}` : ""}`;
    default:                   return "Salesforce event";
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const providedSecret = searchParams.get("secret")?.trim();
  const expectedSecret = process.env.SALESFORCE_WEBHOOK_SECRET?.trim();
  if (expectedSecret && providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: SfWebhookPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = EVENT_MAP[(payload.event || "").toLowerCase()];
  if (!eventType) {
    return NextResponse.json(
      { error: `Unknown event: ${payload.event}`, supported: Object.keys(EVENT_MAP) },
      { status: 200 } // 200 để Salesforce Flow không retry vô hạn
    );
  }

  const email = (payload.email || "").toLowerCase().trim();
  const phone = (payload.phone || "").trim();
  if (!email && !phone && !payload.sf_id) {
    return NextResponse.json({ error: "Missing email/phone/sf_id" }, { status: 400 });
  }

  const seedId = payload.sf_id ? `sf_wh_${payload.sf_id}` : `sf_wh_${Date.now()}`;
  const matches = await batchResolveOrCreate(
    [{ id: seedId, email: email || undefined, phone: phone || undefined, name: payload.name }],
    { source: "salesforce" }
  );
  const leadId = matches[0]?.leadId;
  if (!leadId) {
    return NextResponse.json({ error: "Could not resolve lead" }, { status: 500 });
  }

  const occurredAt = payload.occurred_at || new Date().toISOString();
  // sf_id + event là khoá tự nhiên — ổn định hơn hẳn email/timestamp vì
  // Salesforce Flow có thể fire callout nhiều lần cho cùng 1 thay đổi.
  const rawId = payload.sf_id ? `${payload.sf_id}_${eventType}_${payload.event}` : `${email || phone}_${eventType}_${occurredAt}`;

  const { data: existing } = await admin
    .from("fact_touchpoint")
    .select("id")
    .eq("source", "salesforce")
    .filter("payload->>raw_id", "eq", rawId)
    .limit(1)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true, skipped: "already_recorded", lead_id: leadId });
  }

  const { error } = await admin.from("fact_touchpoint").insert({
    lead_id: leadId,
    source: "salesforce",
    event_type: eventType,
    title: eventTitle(eventType, payload),
    detail: payload.status || payload.rating || payload.product || null,
    occurred_at: occurredAt,
    payload: {
      raw_id: rawId,
      sf_id: payload.sf_id,
      rating: payload.rating,
      status: payload.status,
      product: payload.product,
      via: "webhook",
    },
  });
  if (error) {
    return NextResponse.json({ error: `Insert failed: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, lead_id: leadId, event_type: eventType, occurred_at: occurredAt });
}

// Health check khi cấu hình Flow / test URL từ Salesforce
export async function GET() {
  return NextResponse.json({ status: "ok", service: "salesforce_webhook", accepts: Object.keys(EVENT_MAP) });
}
