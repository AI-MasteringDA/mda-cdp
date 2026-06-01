import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * SMAX Webhook receiver
 *
 * Endpoint: POST /api/webhooks/smax
 *
 * SMAX gửi event mới (chat, customer update) → endpoint này nhận → insert vào:
 *   1. raw_smax_chats — raw payload đầy đủ (audit + debug)
 *   2. fact_touchpoint — extracted touchpoint nếu match được lead qua phone/email
 *
 * Cấu hình trong SMAX dashboard:
 *   URL:         https://<your-vercel-domain>/api/webhooks/smax
 *   Method:      POST
 *   Auth header: x-smax-secret: <SMAX_WEBHOOK_SECRET>
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseSecret = process.env.SUPABASE_SECRET_KEY!;
const webhookSecret = process.env.SMAX_WEBHOOK_SECRET; // optional, recommended for prod

export async function POST(req: NextRequest) {
  try {
    // 1. Verify secret (nếu cấu hình)
    if (webhookSecret) {
      const provided = req.headers.get("x-smax-secret");
      if (provided !== webhookSecret) {
        return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
      }
    }

    // 2. Parse payload
    const payload = await req.json();
    console.log("📨 [SMAX webhook] received:", JSON.stringify(payload).slice(0, 500));

    // 3. Extract common fields (SMAX schema có thể khác — log để debug)
    // Thử nhiều tên field phổ biến
    const phone =
      payload.customer?.phone ||
      payload.customer?.pid ||
      payload.user?.phone ||
      payload.contact?.phone ||
      payload.phone ||
      null;

    const email =
      payload.customer?.email ||
      payload.user?.email ||
      payload.contact?.email ||
      payload.email ||
      null;

    const message =
      payload.message?.text ||
      payload.message?.body ||
      payload.message?.content ||
      payload.text ||
      payload.content ||
      "(no content)";

    const messageId =
      payload.message?.id ||
      payload.id ||
      `smax-wh-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const occurredAt =
      payload.message?.created_at ||
      payload.message?.timestamp ||
      payload.created_at ||
      payload.timestamp ||
      new Date().toISOString();

    const direction = payload.message?.direction || payload.direction || "inbound";
    const channelId = payload.page_pid || payload.channel_id || payload.page_id || null;

    const admin = createClient(supabaseUrl, supabaseSecret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 4. Insert raw (luôn lưu để debug + audit)
    const { error: rawErr } = await admin.from("raw_smax_chats").insert({
      id: messageId,
      user_phone: phone,
      message,
      direction,
      occurred_at: occurredAt,
      raw_data: { webhook: true, channel_id: channelId, full_payload: payload },
    });

    if (rawErr && !rawErr.message.includes("duplicate")) {
      console.warn("[SMAX webhook] insert raw error:", rawErr.message);
    }

    // 5. Identity resolve + insert fact_touchpoint nếu match
    let leadId: string | null = null;
    if (email) {
      const { data } = await admin
        .from("dim_lead")
        .select("lead_id")
        .eq("email", email.toLowerCase().trim())
        .maybeSingle();
      leadId = data?.lead_id ?? null;
    }
    if (!leadId && phone) {
      const normalized = phone.replace(/\s|-|\+84/g, "").replace(/^0/, "");
      const { data: leads } = await admin.from("dim_lead").select("lead_id, phone");
      const match = leads?.find(
        (l) => l.phone && l.phone.replace(/\s|-|\+84/g, "").replace(/^0/, "") === normalized
      );
      leadId = match?.lead_id ?? null;
    }

    // 6. Auto-create lead nếu có email (không tạo cho phone-only vì có thể là spam)
    if (!leadId && email) {
      const { data: newLead } = await admin
        .from("dim_lead")
        .insert({
          email: email.toLowerCase().trim(),
          phone,
          full_name: email.split("@")[0],
          source: "smax",
          stage: "Mới",
          avatar_color: "#FFE3F0",
          first_seen_at: new Date().toISOString(),
        })
        .select("lead_id")
        .single();
      leadId = newLead?.lead_id ?? null;
    }

    // 7. Insert touchpoint
    if (leadId) {
      await admin.from("fact_touchpoint").insert({
        lead_id: leadId,
        source: "smax",
        event_type: "chat",
        title: `Chat: ${message.slice(0, 60)}${message.length > 60 ? "..." : ""}`,
        detail: message,
        occurred_at: occurredAt,
        payload: { direction, channel_id: channelId, real: true, source: "webhook" },
      });

      await admin
        .from("dim_lead")
        .update({ last_touch_at: occurredAt })
        .eq("lead_id", leadId)
        .lt("last_touch_at", occurredAt);
    }

    return NextResponse.json({
      received: true,
      matched_lead: !!leadId,
      message_id: messageId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[SMAX webhook] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Test endpoint — bạn có thể curl GET để kiểm tra deploy
export async function GET() {
  return NextResponse.json({
    status: "ok",
    message: "SMAX webhook endpoint sẵn sàng. POST data từ SMAX sẽ được xử lý.",
    timestamp: new Date().toISOString(),
    has_secret: !!webhookSecret,
  });
}
