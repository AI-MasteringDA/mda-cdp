-- ============================================================================
-- Index cho fact_lead_score — sửa lỗi 500 ở các trang lead
-- ----------------------------------------------------------------------------
-- Triệu chứng: /hot-leads trả "A server error occurred".
-- Nguyên nhân: mọi trang lead chạy
--     SELECT scored_at FROM fact_lead_score ORDER BY scored_at DESC LIMIT 1
-- Bảng đã 230k+ dòng và KHÔNG có index trên scored_at → Postgres quét toàn
-- bảng + sort. Với service_role (không giới hạn) mất ~1-4s nên không lộ; với
-- role của app (statement_timeout ngắn) thì query BỊ HUỶ → trang 500.
--
-- Chạy 1 lần trong Supabase SQL Editor. An toàn chạy lại.
-- ============================================================================

-- 1. Lấy ngày scoring mới nhất — ORDER BY scored_at DESC LIMIT 1
CREATE INDEX IF NOT EXISTS idx_fls_scored_at
  ON fact_lead_score (scored_at DESC);

-- 2. Lọc lead theo tier trong 1 ngày — WHERE scored_at = ? AND hot_score BETWEEN ?
CREATE INDEX IF NOT EXISTS idx_fls_scored_at_hot
  ON fact_lead_score (scored_at, hot_score DESC);

-- 3. Tra điểm của 1 lead (trang chi tiết)
CREATE INDEX IF NOT EXISTS idx_fls_lead_id
  ON fact_lead_score (lead_id);

ANALYZE fact_lead_score;

-- ── Kiểm chứng ──────────────────────────────────────────────────────────────
-- Phải thấy "Index Scan" (không phải "Seq Scan"), thời gian < 5ms:
EXPLAIN ANALYZE
SELECT scored_at FROM fact_lead_score ORDER BY scored_at DESC LIMIT 1;
