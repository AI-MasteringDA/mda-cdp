-- ─────────────────────────────────────────────────────────────────────────
-- "Chưa phản hồi" — tính thuần-DB, chính xác, không đọc history.
--
-- BUG cũ: lark-push tick theo touchpoint MỚI NHẤT bất kỳ trong view. Nhưng
-- view lẫn cả touchpoint kiểu "customer-list" (payload.tid = null) — loại này
-- LUÔN bị dán event_type='chat' vì lấy từ danh sách khách, không có thông tin
-- người gửi. → nhiều lead bị tick kẹt vĩnh viễn dù TVV đã trả lời (SMAX không
-- ingest tin TVV thành touchpoint, nên hệ thống tưởng khách nhắn cuối).
--
-- FIX: chỉ xét touchpoint kiểu THREAD (payload.tid NOT NULL) — loại duy nhất
-- mang thông tin người gửi. SMAX đã cho sẵn last_message_by_customer_at ở cấp
-- thread; smax-real.ts đã so nó với last_message_at và dán:
--     khách nhắn cuối  → event_type='chat'
--     TVV nhắn cuối     → event_type='chat_staff'
-- Nên "chưa phản hồi" = thread MỚI NHẤT của lead có nhãn 'chat' VÀ trong 30 ngày,
-- loại trừ tin AUTO (thiệp sinh nhật SMAX bơm vào — bị tính là tin khách sai;
-- xem cờ payload.auto_last_note do smax-real.ts gắn).
--
-- Tự tươi: khi TVV rep, last_message_at của thread bật lên → lần sync SMAX kế
-- (≤7 phút) pull lại thread đó → đổi thành 'chat_staff' → cờ tự tắt. 0 call thêm.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_smax_lead_snapshot AS
SELECT DISTINCT ON (t.lead_id)
  t.lead_id,
  t.event_type,
  t.title,
  t.detail,
  t.occurred_at,
  t.payload->>'customer_name' AS fallback_name,
  cnt.total_chats,
  l.full_name, l.email, l.phone, l.company, l.stage, l.assignee,
  l.smax_tags, l.external_profile_id,
  COALESCE(reply.chua_phan_hoi, false) AS chua_phan_hoi
FROM fact_touchpoint t
JOIN (
  SELECT lead_id, COUNT(*) AS total_chats
  FROM fact_touchpoint
  WHERE source = 'smax'
  GROUP BY lead_id
) cnt USING (lead_id)
LEFT JOIN (
  -- Thread SMAX mới nhất mỗi lead (chỉ loại có tid = mang thông tin người gửi).
  -- occurred_at của thread = last_message_at; với nhãn 'chat' thì đó chính là
  -- lúc KHÁCH nhắn cuối → mốc 7 ngày đo đúng trên tin của khách.
  SELECT DISTINCT ON (lead_id)
    lead_id,
    (event_type = 'chat'
     AND occurred_at > now() - interval '30 days'
     AND COALESCE(payload->>'auto_last_note', 'false') <> 'true') AS chua_phan_hoi
  FROM fact_touchpoint
  WHERE source = 'smax' AND payload->>'tid' IS NOT NULL
  ORDER BY lead_id, occurred_at DESC
) reply ON reply.lead_id = t.lead_id
LEFT JOIN dim_lead l ON l.lead_id = t.lead_id
WHERE t.source = 'smax'
ORDER BY t.lead_id, t.occurred_at DESC;

-- Verify (chạy thử sau khi tạo view):
-- SELECT count(*) FILTER (WHERE chua_phan_hoi) AS chua_phan_hoi,
--        count(*)                               AS tong
-- FROM v_smax_lead_snapshot;   -- kỳ vọng: chua_phan_hoi ~ 30-40, không phải 8000+
