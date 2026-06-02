-- ============================================================
-- Fix: backfill stage="Đã chốt" cho lead có conversion touchpoint
-- ------------------------------------------------------------
-- Nếu lead đã có 1 touchpoint event_type='conversion' (Closed Won),
-- chắc chắn là học viên thật → stage="Đã chốt"
-- ============================================================

-- Show số leads sẽ được update
SELECT
  COUNT(DISTINCT t.lead_id) AS leads_with_conversion,
  COUNT(DISTINCT l.lead_id) FILTER (WHERE l.stage = 'Đã chốt') AS already_marked
FROM fact_touchpoint t
JOIN dim_lead l ON l.lead_id = t.lead_id
WHERE t.event_type = 'conversion';

-- Update
UPDATE dim_lead
SET stage = 'Đã chốt'
WHERE lead_id IN (
  SELECT DISTINCT lead_id
  FROM fact_touchpoint
  WHERE event_type = 'conversion'
)
AND stage != 'Đã chốt';

-- Show kết quả
SELECT
  stage,
  COUNT(*) AS count
FROM dim_lead
GROUP BY stage
ORDER BY count DESC;
