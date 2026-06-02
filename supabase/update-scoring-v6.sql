-- ============================================================
-- Scoring V6 — sử dụng pre-computed aggregates trên dim_lead
-- ------------------------------------------------------------
-- V5 mỗi lần recompute phải scan toàn bộ fact_touchpoint (~22k rows
-- × 13k leads) → chậm + tốn. V6 đọc aggregates đã cache → nhanh.
--
-- Logic mới (engagement-aware):
-- - "Chat trong 3 ngày" dùng last_chat_at
-- - "TVV reply" dùng last_chat_staff_at
-- - "Engagement rate" dùng email_open / email_received
-- - "Đa kênh" dùng source_count
-- - "Im lặng" dùng last_engagement_at (KHÔNG dùng last_email_at vì
--    nhận newsletter spam không phải tương tác chủ động)
-- ============================================================

DROP FUNCTION IF EXISTS recompute_lead_scores();

CREATE FUNCTION recompute_lead_scores()
RETURNS TABLE (out_lead_id UUID, out_score INT, out_tier TEXT) AS $$
BEGIN
  RETURN QUERY
  WITH
  signals AS (
    SELECT
      l.lead_id AS lid,
      -- Recency flags from aggregates
      (l.last_chat_at > NOW() - INTERVAL '3 days') AS chat_recent,
      (l.last_chat_staff_at > NOW() - INTERVAL '3 days') AS reply_recent,
      (l.last_email_at > NOW() - INTERVAL '7 days') AS email_recent,
      l.chat_staff_count AS staff_total,
      l.total_touchpoints AS engagement_total,
      l.source_count AS source_count,
      l.conversion_count AS conversions,
      l.email_open_count AS opens,
      l.email_received_count AS emails_sent,

      -- Days since last engagement (NOT email — emails sent to spam list)
      COALESCE(
        EXTRACT(EPOCH FROM (NOW() - l.last_engagement_at)) / 86400,
        9999
      ) AS silent_days,

      -- Has any genuine engagement?
      (l.chat_count + l.chat_staff_count + l.email_open_count + l.email_click_count + l.conversion_count) > 0 AS has_engagement
    FROM dim_lead l
    WHERE l.stage != 'Đã chốt'
  ),
  computed AS (
    SELECT
      s.lid,
      s.chat_recent, s.reply_recent, s.email_recent,
      s.staff_total, s.engagement_total, s.source_count,
      s.conversions, s.opens, s.emails_sent, s.silent_days, s.has_engagement,
      -- BASE 40 + positive boosts - decay penalties
      40 +
      (CASE WHEN s.chat_recent THEN 35 ELSE 0 END) +
      (CASE WHEN s.reply_recent THEN 20 ELSE 0 END) +
      (CASE WHEN s.email_recent THEN 5 ELSE 0 END) +
      (CASE WHEN s.staff_total >= 5 THEN 15 ELSE 0 END) +
      (CASE WHEN s.engagement_total >= 5 THEN 10 ELSE 0 END) +
      (CASE WHEN s.source_count >= 2 THEN 20 ELSE 0 END) +
      (CASE WHEN s.conversions > 0 THEN 25 ELSE 0 END) +
      -- Engagement quality: open rate > 30% = bonus, never opened = penalty
      (CASE
        WHEN s.emails_sent >= 5 AND s.opens::FLOAT / NULLIF(s.emails_sent, 0) > 0.3 THEN 15
        WHEN s.emails_sent >= 10 AND s.opens = 0 THEN -10
        ELSE 0
      END) +
      -- Silence decay
      (CASE
        WHEN s.silent_days <= 30 THEN 0
        WHEN s.silent_days <= 90 THEN -20
        WHEN s.silent_days <= 180 THEN -40
        ELSE -60
      END) +
      (CASE WHEN NOT s.has_engagement THEN -10 ELSE 0 END)
      AS raw_score
    FROM signals s
  ),
  clamped AS (
    SELECT
      c.lid,
      GREATEST(0, LEAST(100, c.raw_score))::INT AS score,
      (
        SELECT jsonb_agg(reason ORDER BY (reason->>'points')::int DESC)
        FROM (
          SELECT jsonb_build_object('sign', '+', 'label', 'Chat trong 3 ngày qua', 'points', 35) AS reason WHERE c.chat_recent
          UNION ALL SELECT jsonb_build_object('sign', '+', 'label', 'TVV reply trong 3 ngày', 'points', 20) WHERE c.reply_recent
          UNION ALL SELECT jsonb_build_object('sign', '+', 'label', 'MDA gửi email trong 7 ngày', 'points', 5) WHERE c.email_recent
          UNION ALL SELECT jsonb_build_object('sign', '+', 'label', 'TVV chat tổng >= 5 lần', 'points', 15) WHERE c.staff_total >= 5
          UNION ALL SELECT jsonb_build_object('sign', '+', 'label', 'Tổng tương tác >= 5', 'points', 10) WHERE c.engagement_total >= 5
          UNION ALL SELECT jsonb_build_object('sign', '+', 'label', 'Đa kênh (>= 2 nguồn)', 'points', 20) WHERE c.source_count >= 2
          UNION ALL SELECT jsonb_build_object('sign', '+', 'label', 'Đã từng mua khóa khác', 'points', 25) WHERE c.conversions > 0
          UNION ALL SELECT jsonb_build_object('sign', '+', 'label', 'Mở email > 30% (engaged)', 'points', 15)
            WHERE c.emails_sent >= 5 AND c.opens::FLOAT / NULLIF(c.emails_sent, 0) > 0.3
          UNION ALL SELECT jsonb_build_object('sign', '-', 'label', 'Nhận nhiều email nhưng không mở', 'points', 10)
            WHERE c.emails_sent >= 10 AND c.opens = 0
          UNION ALL SELECT jsonb_build_object('sign', '-', 'label', 'Im lặng 30-90 ngày', 'points', 20) WHERE c.silent_days > 30 AND c.silent_days <= 90
          UNION ALL SELECT jsonb_build_object('sign', '-', 'label', 'Im lặng 90-180 ngày', 'points', 40) WHERE c.silent_days > 90 AND c.silent_days <= 180
          UNION ALL SELECT jsonb_build_object('sign', '-', 'label', 'Im lặng > 180 ngày', 'points', 60) WHERE c.silent_days > 180
          UNION ALL SELECT jsonb_build_object('sign', '-', 'label', 'Chưa từng tương tác thật sự', 'points', 10) WHERE NOT c.has_engagement
        ) reasons_subq
      ) AS reasons_json
    FROM computed c
  ),
  upserted AS (
    INSERT INTO fact_lead_score (lead_id, scored_at, hot_score, cold_score, hot_reasons, cold_reasons)
    SELECT
      cl.lid, CURRENT_DATE, cl.score, GREATEST(0, 100 - cl.score),
      COALESCE(cl.reasons_json, '[]'::jsonb), '[]'::jsonb
    FROM clamped cl
    ON CONFLICT (lead_id, scored_at) DO UPDATE SET
      hot_score = EXCLUDED.hot_score,
      cold_score = EXCLUDED.cold_score,
      hot_reasons = EXCLUDED.hot_reasons,
      cold_reasons = EXCLUDED.cold_reasons
    RETURNING fact_lead_score.lead_id, fact_lead_score.hot_score
  )
  SELECT u.lead_id, u.hot_score, lead_tier(u.hot_score) FROM upserted u;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION recompute_lead_scores() TO anon, authenticated;

-- Run
SELECT 'Recompute V6 — fast (uses cached aggregates)...' AS step;
SELECT COUNT(*) AS total_scored FROM recompute_lead_scores();

SELECT 'V6 distribution' AS step;
SELECT lead_tier(hot_score) AS tier, COUNT(*) AS count, MIN(hot_score) AS min, MAX(hot_score) AS max
FROM fact_lead_score WHERE scored_at = CURRENT_DATE
GROUP BY tier ORDER BY min DESC;
