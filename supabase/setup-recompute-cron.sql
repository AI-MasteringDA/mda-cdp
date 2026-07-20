-- ============================================================================
-- Recompute scoring bằng pg_cron — chạy BÊN TRONG database, không qua API
-- ----------------------------------------------------------------------------
-- Vì sao (2026-07-20): recompute_lead_scores() mất ~9.5s. Gọi qua API/PostgREST
-- (đường ETL cũ) luôn bị cắt ở statement_timeout ~8s — và ALTER ROLE service_role
-- KHÔNG áp được cho đường "SET ROLE" của PostgREST. Nhưng chạy trong DB (SQL
-- Editor / pg_cron) thì KHÔNG dính giới hạn đó → luôn chạy xong.
--
-- Giải pháp: pg_cron chạy recompute mỗi GIỜ, ngay trong database. ETL không còn
-- gọi recompute nữa (nhẹ tải, không giữ connection lâu).
-- ============================================================================

-- pg_cron thường đã bật sẵn trên Supabase. Nếu chưa:
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Gỡ lịch cũ trùng tên (chạy lại file này nhiều lần vẫn an toàn)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recompute-scores') THEN
    PERFORM cron.unschedule('recompute-scores');
  END IF;
END $$;

-- Lịch: mỗi giờ, phút 05 (tránh trùng các mốc chẵn). Chạy trong DB → không timeout.
-- Điểm/tier lead không đổi từng phút nên mỗi giờ là dư tươi; nhẹ cho free-tier.
SELECT cron.schedule('recompute-scores', '5 * * * *', $$SELECT recompute_lead_scores();$$);

-- Kiểm tra đã tạo:
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'recompute-scores';

-- (Tuỳ chọn) Chấm lại NGAY 1 lần để lấp điểm cũ — bỏ comment 2 dòng dưới nếu muốn
-- refresh liền (chạy trong SQL Editor nên không timeout, ~10s):
-- SELECT recompute_lead_scores();
