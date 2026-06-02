-- ============================================================
-- Fix: dim_lead_stage_check không cho phép "Đã chốt"
-- ------------------------------------------------------------
-- Schema gốc chỉ allow: Mới, Đang tư vấn, Đang cân nhắc, Im lặng
-- → UPDATE stage='Đã chốt' silently fail trong tất cả ETL trước đó!
-- Fix: drop constraint cũ, add constraint mới với "Đã chốt"
-- ============================================================

-- 1. Drop constraint cũ
ALTER TABLE dim_lead DROP CONSTRAINT IF EXISTS dim_lead_stage_check;

-- 2. Add constraint mới có "Đã chốt"
ALTER TABLE dim_lead ADD CONSTRAINT dim_lead_stage_check
  CHECK (stage IN ('Mới', 'Đang tư vấn', 'Đang cân nhắc', 'Im lặng', 'Đã chốt'));

-- 3. Mark "Đã chốt" cho lead có conversion event
UPDATE dim_lead
SET stage = 'Đã chốt'
WHERE lead_id IN (
  SELECT DISTINCT lead_id FROM fact_touchpoint WHERE event_type = 'conversion'
) AND stage != 'Đã chốt';

-- 4. Show kết quả
SELECT stage, COUNT(*) AS count FROM dim_lead GROUP BY stage ORDER BY count DESC;
