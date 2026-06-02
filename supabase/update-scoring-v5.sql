-- ============================================================
-- Scoring V5 — SINGLE SCORE 0-100 + categorical TIER
-- ------------------------------------------------------------
-- Vấn đề V1-V4: hai axis (hot + cold) gây mơ hồ. Lead có cold=100
-- nhìn giống "100 điểm = hoàn hảo" nhưng ý là "DEAD". Khi rules
-- stack lên cap 100 → mất phân biệt.
--
-- V5: Một score duy nhất (0-100) với decay/boost cộng-trừ rõ ràng.
-- Tier dẫn xuất từ score:
--   70-100 NÓNG (gọi NGAY)
--   40-69  ẤM   (follow-up tuần này)
--   20-39  MÁT  (re-activation email batch)
--   0-19   NGỦ ĐÔNG (close case)
--
-- Schema: dùng lại `hot_score` làm unified score. `cold_score` deprecated
-- (set = 100 - hot_score để backward-compat /cold-leads query).
-- ============================================================

-- 1. Disable TẤT CẢ rules cũ (V2-V4)
UPDATE scoring_rule SET enabled = false;

-- 2. Drop function cũ
DROP FUNCTION IF EXISTS recompute_lead_scores();

-- 3. Helper function: tier from score
CREATE OR REPLACE FUNCTION lead_tier(score INT) RETURNS TEXT AS $$
  SELECT CASE
    WHEN score >= 70 THEN 'NÓNG'
    WHEN score >= 40 THEN 'ẤM'
    WHEN score >= 20 THEN 'MÁT'
    ELSE 'NGỦ ĐÔNG'
  END;
$$ LANGUAGE sql IMMUTABLE;

GRANT EXECUTE ON FUNCTION lead_tier(INT) TO anon, authenticated;

-- 4. Main scoring function — inline math (no scoring_rule table needed)
CREATE FUNCTION recompute_lead_scores()
RETURNS TABLE (out_lead_id UUID, out_score INT, out_tier TEXT) AS $$
BEGIN
  RETURN QUERY
  WITH
  signals AS (
    SELECT
      l.lead_id AS lid,
      -- Engagement counters
      COUNT(*) FILTER (WHERE t.event_type = 'chat' AND t.occurred_at > NOW() - INTERVAL '3 days') AS chat_3d,
      COUNT(*) FILTER (WHERE t.event_type = 'chat_staff' AND t.occurred_at > NOW() - INTERVAL '3 days') AS reply_3d,
      COUNT(*) FILTER (WHERE t.event_type = 'email_sent' AND t.occurred_at > NOW() - INTERVAL '7 days') AS email_7d,
      COUNT(*) FILTER (WHERE t.event_type = 'chat_staff' AND t.occurred_at > NOW() - INTERVAL '90 days') AS chat_staff_total,
      COUNT(*) FILTER (
        WHERE t.occurred_at > NOW() - INTERVAL '90 days'
        AND t.event_type IN ('chat','chat_staff','email_sent','email_open','email_click','call','meeting','note','form_submit','page_view')
      ) AS total_engagement,
      COUNT(DISTINCT t.source) FILTER (WHERE t.source IN ('smax','salesforce','instantly','web','fanpage')) AS source_count,
      COUNT(*) FILTER (WHERE t.event_type = 'conversion') AS has_conversion,

      -- Silence: days since last meaningful touchpoint
      COALESCE(
        EXTRACT(EPOCH FROM (NOW() - MAX(t.occurred_at) FILTER (
          WHERE t.event_type IN ('chat','chat_staff','email_sent','email_open','call','meeting','form_submit','page_view','conversion')
        ))) / 86400,
        9999
      ) AS silent_days,

      -- Never engaged: chỉ có lead_created event, không có gì khác
      COUNT(*) FILTER (
        WHERE t.event_type IN ('chat','chat_staff','email_sent','email_open','email_click','call','meeting','form_submit','page_view','conversion')
      ) AS engagement_count
    FROM dim_lead l
    LEFT JOIN fact_touchpoint t ON t.lead_id = l.lead_id
    WHERE l.stage != 'Đã chốt'
    GROUP BY l.lead_id
  ),
  computed AS (
    SELECT
      s.lid,
      s.chat_3d,
      s.reply_3d,
      s.email_7d,
      s.chat_staff_total,
      s.total_engagement,
      s.source_count,
      s.has_conversion,
      s.silent_days,
      s.engagement_count,
      -- Bắt đầu base 40 (trung tính cho lead mới)
      40 +
      -- POSITIVE points
      (CASE WHEN s.chat_3d > 0 THEN 35 ELSE 0 END) +
      (CASE WHEN s.reply_3d > 0 THEN 20 ELSE 0 END) +
      (CASE WHEN s.email_7d > 0 THEN 10 ELSE 0 END) +
      (CASE WHEN s.chat_staff_total >= 5 THEN 15 ELSE 0 END) +
      (CASE WHEN s.total_engagement >= 5 THEN 15 ELSE 0 END) +
      (CASE WHEN s.source_count >= 2 THEN 20 ELSE 0 END) +
      (CASE WHEN s.has_conversion > 0 THEN 25 ELSE 0 END) +
      -- NEGATIVE points (decay)
      (CASE
        WHEN s.silent_days <= 30 THEN 0
        WHEN s.silent_days <= 90 THEN -20
        WHEN s.silent_days <= 180 THEN -40
        ELSE -60
      END) +
      (CASE WHEN s.engagement_count = 0 THEN -10 ELSE 0 END)
      AS raw_score
    FROM signals s
  ),
  clamped AS (
    SELECT
      c.lid,
      GREATEST(0, LEAST(100, c.raw_score))::INT AS score,
      -- Reasons: build JSON array of {sign, label, points}
      (
        SELECT jsonb_agg(reason ORDER BY (reason->>'points')::int DESC)
        FROM (
          SELECT jsonb_build_object('sign', '+', 'label', 'Chat trong 3 ngày qua', 'points', 35) AS reason WHERE c.chat_3d > 0
          UNION ALL SELECT jsonb_build_object('sign', '+', 'label', 'TVV reply trong 3 ngày', 'points', 20) WHERE c.reply_3d > 0
          UNION ALL SELECT jsonb_build_object('sign', '+', 'label', 'MDA gửi email trong 7 ngày', 'points', 10) WHERE c.email_7d > 0
          UNION ALL SELECT jsonb_build_object('sign', '+', 'label', 'TVV chat tổng >= 5 lần', 'points', 15) WHERE c.chat_staff_total >= 5
          UNION ALL SELECT jsonb_build_object('sign', '+', 'label', 'Tổng tương tác >= 5', 'points', 15) WHERE c.total_engagement >= 5
          UNION ALL SELECT jsonb_build_object('sign', '+', 'label', 'Đa kênh (>= 2 nguồn)', 'points', 20) WHERE c.source_count >= 2
          UNION ALL SELECT jsonb_build_object('sign', '+', 'label', 'Đã từng mua khóa khác', 'points', 25) WHERE c.has_conversion > 0
          UNION ALL SELECT jsonb_build_object('sign', '-', 'label', 'Im lặng 30-90 ngày', 'points', 20) WHERE c.silent_days > 30 AND c.silent_days <= 90
          UNION ALL SELECT jsonb_build_object('sign', '-', 'label', 'Im lặng 90-180 ngày', 'points', 40) WHERE c.silent_days > 90 AND c.silent_days <= 180
          UNION ALL SELECT jsonb_build_object('sign', '-', 'label', 'Im lặng > 180 ngày', 'points', 60) WHERE c.silent_days > 180
          UNION ALL SELECT jsonb_build_object('sign', '-', 'label', 'Chưa từng tương tác', 'points', 10) WHERE c.engagement_count = 0
        ) reasons_subq
      ) AS reasons_json
    FROM computed c
  ),
  upserted AS (
    INSERT INTO fact_lead_score (lead_id, scored_at, hot_score, cold_score, hot_reasons, cold_reasons)
    SELECT
      cl.lid,
      CURRENT_DATE,
      cl.score,                                     -- unified score in hot_score column
      GREATEST(0, 100 - cl.score),                  -- inverted for backward-compat (deprecated)
      COALESCE(cl.reasons_json, '[]'::jsonb),       -- all reasons in hot_reasons
      '[]'::jsonb                                   -- cold_reasons deprecated
    FROM clamped cl
    ON CONFLICT (lead_id, scored_at) DO UPDATE SET
      hot_score    = EXCLUDED.hot_score,
      cold_score   = EXCLUDED.cold_score,
      hot_reasons  = EXCLUDED.hot_reasons,
      cold_reasons = EXCLUDED.cold_reasons
    RETURNING fact_lead_score.lead_id, fact_lead_score.hot_score
  )
  SELECT u.lead_id, u.hot_score, lead_tier(u.hot_score) FROM upserted u;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION recompute_lead_scores() TO anon, authenticated;

-- 5. Recompute
SELECT 'Recomputing V5...' AS step;
SELECT COUNT(*) AS total_scored FROM recompute_lead_scores();

-- 6. Tier distribution
SELECT 'Tier distribution V5' AS metric;
SELECT
  lead_tier(hot_score) AS tier,
  COUNT(*) AS count,
  MIN(hot_score) AS min_score,
  MAX(hot_score) AS max_score
FROM fact_lead_score WHERE scored_at = CURRENT_DATE
GROUP BY tier ORDER BY min_score DESC;

-- 7. Score histogram
SELECT 'Score histogram (granular)' AS metric;
SELECT
  (hot_score / 10) * 10 AS bucket_start,
  COUNT(*) AS count
FROM fact_lead_score WHERE scored_at = CURRENT_DATE
GROUP BY bucket_start ORDER BY bucket_start DESC;

-- 8. Sample
SELECT 'Sample 5 leads per tier' AS metric;
WITH tiered AS (
  SELECT s.lead_id, s.hot_score, lead_tier(s.hot_score) AS tier, s.hot_reasons, l.full_name,
    ROW_NUMBER() OVER (PARTITION BY lead_tier(s.hot_score) ORDER BY RANDOM()) AS rn
  FROM fact_lead_score s
  JOIN dim_lead l ON l.lead_id = s.lead_id
  WHERE s.scored_at = CURRENT_DATE
)
SELECT tier, hot_score, full_name, hot_reasons
FROM tiered WHERE rn <= 3
ORDER BY tier, hot_score DESC;
