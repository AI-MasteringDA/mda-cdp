-- ============================================================
-- CLEANUP — Xóa hết fake seed data, giữ lại data thật từ ETL
-- ------------------------------------------------------------
-- An toàn: ON DELETE CASCADE sẽ tự xóa fact_touchpoint +
-- fact_lead_score liên quan đến các lead bị xóa.
-- ============================================================

-- 1. Xóa 10 fake seed leads (UUID kiểu "11111111-...")
-- CASCADE sẽ tự xóa touchpoints + scores
DELETE FROM dim_lead WHERE lead_id::text LIKE '11111111-%';

-- 2. Xóa raw data từ simulator (raw_data có flag 'simulator')
DELETE FROM raw_smax_chats       WHERE raw_data->>'simulator' = 'true';
DELETE FROM raw_instantly_emails WHERE raw_data->>'simulator' = 'true';

-- 3. Xóa fact_touchpoint mồ côi (touchpoints không có flag 'real')
-- Nếu touchpoint không phải từ real API và lead còn tồn tại → vẫn xóa
-- (chỉ giữ touchpoint có payload.real = 'true')
DELETE FROM fact_touchpoint
WHERE payload IS NULL OR payload->>'real' IS DISTINCT FROM 'true';

-- 4. Xóa fake sync_jobs cũ (giữ lại 24h gần nhất từ ETL)
DELETE FROM sync_job WHERE started_at < NOW() - INTERVAL '24 hours';

-- 5. Recompute scores cho data thật còn lại
SELECT count(*) AS leads_remaining FROM dim_lead;
SELECT count(*) AS touchpoints_remaining FROM fact_touchpoint;
SELECT * FROM recompute_lead_scores() ORDER BY out_hot DESC LIMIT 10;
