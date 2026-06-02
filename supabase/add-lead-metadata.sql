-- ============================================================
-- Add Lead Metadata Columns + Backfill "Lead Created" Touchpoint
-- ------------------------------------------------------------
-- Mục đích: timeline mọi lead có ít nhất 1 event (creation),
-- profile hiển thị company + TVV phụ trách + nguồn detail.
-- ============================================================

-- 1. Add columns
ALTER TABLE dim_lead
  ADD COLUMN IF NOT EXISTS company TEXT,
  ADD COLUMN IF NOT EXISTS assignee TEXT,
  ADD COLUMN IF NOT EXISTS lead_source TEXT;

COMMENT ON COLUMN dim_lead.company IS 'Company từ Salesforce Account.Name hoặc Lead.Company';
COMMENT ON COLUMN dim_lead.assignee IS 'TVV phụ trách (Owner.Name từ Salesforce)';
COMMENT ON COLUMN dim_lead.lead_source IS 'Kênh chi tiết (Lead.LeadSource, campaign...) - khác với cột source là loại nguồn';

-- 2. Backfill "Lead Created" touchpoint cho lead chưa có
INSERT INTO fact_touchpoint (lead_id, source, event_type, title, detail, occurred_at, payload)
SELECT
  l.lead_id,
  l.source,
  'lead_created',
  CASE l.source
    WHEN 'salesforce' THEN '🚪 Tạo lead trong Salesforce'
    WHEN 'instantly'  THEN '🚪 Vào hệ thống qua Instantly email'
    WHEN 'smax'       THEN '🚪 Vào hệ thống qua SMAX chat'
    WHEN 'fanpage'    THEN '🚪 Tạo lead từ Fanpage'
    WHEN 'web'        THEN '🚪 Tạo lead từ Website'
    ELSE              '🚪 Tạo lead'
  END,
  NULL,
  COALESCE(l.first_seen_at, NOW()),
  jsonb_build_object('source', l.source, 'backfilled', true)
FROM dim_lead l
LEFT JOIN fact_touchpoint t
  ON t.lead_id = l.lead_id AND t.event_type = 'lead_created'
WHERE t.id IS NULL;

-- 3. Show kết quả backfill
SELECT
  COUNT(*) FILTER (WHERE event_type = 'lead_created') AS lead_created_count,
  COUNT(DISTINCT lead_id) FILTER (WHERE event_type = 'lead_created') AS unique_leads_with_created
FROM fact_touchpoint;
