-- ============================================================
-- Dedupe fact_touchpoint — giữ 1 touchpoint duy nhất mỗi (source, raw_id)
-- ------------------------------------------------------------
-- Nguyên nhân: ETL chạy nhiều lần insert lặp.
-- Fix: ROW_NUMBER() group theo source + thread_id/raw_id, keep oldest.
-- ============================================================

-- 1. Trước khi dedupe — show số liệu
SELECT
  source,
  COUNT(*) AS total_rows,
  COUNT(DISTINCT (payload->>'thread_id')) AS unique_thread_ids,
  COUNT(DISTINCT (payload->>'raw_id')) AS unique_raw_ids
FROM fact_touchpoint
GROUP BY source
ORDER BY source;

-- 2. Dedupe SMAX — keep oldest row per (lead_id, thread_id)
WITH ranked_smax AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY lead_id, payload->>'thread_id'
           ORDER BY id
         ) AS rn
  FROM fact_touchpoint
  WHERE source = 'smax'
    AND payload->>'thread_id' IS NOT NULL
)
DELETE FROM fact_touchpoint
WHERE id IN (SELECT id FROM ranked_smax WHERE rn > 1);

-- 3. Dedupe Instantly — keep oldest row per (lead_id, raw_id)
WITH ranked_instantly AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY lead_id, payload->>'raw_id'
           ORDER BY id
         ) AS rn
  FROM fact_touchpoint
  WHERE source = 'instantly'
    AND payload->>'raw_id' IS NOT NULL
)
DELETE FROM fact_touchpoint
WHERE id IN (SELECT id FROM ranked_instantly WHERE rn > 1);

-- 4. Sau dedupe — show số liệu lại
SELECT
  source,
  COUNT(*) AS total_rows,
  COUNT(DISTINCT (payload->>'thread_id')) AS unique_thread_ids,
  COUNT(DISTINCT (payload->>'raw_id')) AS unique_raw_ids
FROM fact_touchpoint
GROUP BY source
ORDER BY source;

-- 5. Tạo UNIQUE INDEX để future inserts auto-skip duplicates
-- (Sẽ throw error nếu connector insert trùng → ETL phải dùng ON CONFLICT)
CREATE UNIQUE INDEX IF NOT EXISTS uq_touchpoint_smax_thread
ON fact_touchpoint ((payload->>'thread_id'))
WHERE source = 'smax' AND payload->>'thread_id' IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_touchpoint_instantly_raw
ON fact_touchpoint ((payload->>'raw_id'))
WHERE source = 'instantly' AND payload->>'raw_id' IS NOT NULL;

-- 6. Recompute scores với data đã clean
SELECT * FROM recompute_lead_scores() ORDER BY out_hot DESC LIMIT 10;
