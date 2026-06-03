-- ============================================================
-- V7: Fix scoring inflation + reclassify existing SMAX threads
-- ------------------------------------------------------------
-- Vấn đề tìm thấy:
-- 1. SMAX ETL phân loại sai sender: TVV nói nhưng label 'chat'
-- 2. Scoring V6 dùng total_touchpoints (bao gồm lead_created)
--    → duplicate lead_created từ SF inflate điểm
-- 3. Lead có 6 lead_created + 1 TVV msg vẫn score 100/100
--
-- V7 fix:
-- A. Reclassify existing SMAX threads: nếu last_msg > last_customer_msg
--    hoặc không có last_customer_msg → event_type='chat_staff'
-- B. Scoring dùng aggregate có ý nghĩa thật (chat_count, email_open_count...)
--    KHÔNG dùng total_touchpoints
-- C. "Tổng tương tác" = real engagement events
-- D. "Đa kênh" yêu cầu >= 1 engagement (không phải chỉ lead_created) ở mỗi nguồn
-- ============================================================

-- A. RECLASSIFY existing SMAX threads (one-time backfill)
-- Use payload to determine sender. If sender_is_staff exists → use that.
-- Otherwise heuristic: compare last_msg_at vs last_customer_msg_at in payload.

UPDATE fact_touchpoint
SET event_type = 'chat_staff',
    title = REPLACE(title, 'Chat: ', 'TVV chat: ')
WHERE source = 'smax'
  AND event_type = 'chat'
  AND (
    -- Has sender_is_staff field marked true
    (payload->>'sender_is_staff')::boolean = true
    OR
    -- Heuristic: last_msg later than last_customer_msg
    (payload->>'last_msg_at' IS NOT NULL
     AND payload->>'last_customer_msg_at' IS NOT NULL
     AND (payload->>'last_msg_at')::timestamptz > (payload->>'last_customer_msg_at')::timestamptz)
    OR
    -- No customer message recorded but has message → broadcast from TVV
    (payload->>'last_msg_at' IS NOT NULL AND payload->>'last_customer_msg_at' IS NULL)
  );

SELECT 'Reclassified SMAX threads — old chat counts' AS step;
SELECT event_type, COUNT(*) FROM fact_touchpoint
WHERE source = 'smax'
GROUP BY event_type;

-- B. Update recompute_lead_aggregates to also compute engagement_total
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS engagement_count INT DEFAULT 0;

CREATE OR REPLACE FUNCTION recompute_lead_aggregates() RETURNS INT AS $$
DECLARE
  updated_count INT;
BEGIN
  WITH agg AS (
    SELECT
      lead_id,
      COUNT(*) AS total_touchpoints,
      COUNT(*) FILTER (WHERE event_type = 'email_sent')  AS email_received_count,
      COUNT(*) FILTER (WHERE event_type = 'email_open')  AS email_open_count,
      COUNT(*) FILTER (WHERE event_type = 'email_click') AS email_click_count,
      COUNT(*) FILTER (WHERE event_type = 'chat')        AS chat_count,
      COUNT(*) FILTER (WHERE event_type = 'chat_staff')  AS chat_staff_count,
      COUNT(*) FILTER (WHERE event_type = 'conversion')  AS conversion_count,
      COUNT(*) FILTER (WHERE event_type = 'page_view')   AS web_page_view_count,
      -- NEW: meaningful engagement count (excludes lead_created)
      COUNT(*) FILTER (
        WHERE event_type IN ('chat','chat_staff','email_open','email_click','email_reply','call','meeting','form_submit','page_view','conversion')
      ) AS engagement_count,
      MAX(occurred_at) FILTER (WHERE event_type IN ('email_sent','email_open','email_click','email_reply')) AS last_email_at,
      MAX(occurred_at) FILTER (WHERE event_type = 'chat')                AS last_chat_at,
      MAX(occurred_at) FILTER (WHERE event_type = 'chat_staff')          AS last_chat_staff_at,
      MAX(occurred_at) FILTER (
        WHERE event_type IN ('chat','chat_staff','email_open','email_click','email_reply','call','meeting','form_submit','page_view','conversion')
      ) AS last_engagement_at,
      -- source_count: only sources where lead has REAL engagement (not just lead_created)
      COUNT(DISTINCT source) FILTER (
        WHERE source IN ('smax','salesforce','instantly','web','fanpage')
          AND event_type IN ('chat','chat_staff','email_open','email_click','call','meeting','form_submit','page_view','conversion')
      ) AS source_count
    FROM fact_touchpoint
    GROUP BY lead_id
  )
  UPDATE dim_lead d SET
    total_touchpoints     = COALESCE(a.total_touchpoints, 0),
    email_received_count  = COALESCE(a.email_received_count, 0),
    email_open_count      = COALESCE(a.email_open_count, 0),
    email_click_count     = COALESCE(a.email_click_count, 0),
    chat_count            = COALESCE(a.chat_count, 0),
    chat_staff_count      = COALESCE(a.chat_staff_count, 0),
    conversion_count      = COALESCE(a.conversion_count, 0),
    web_page_view_count   = COALESCE(a.web_page_view_count, 0),
    engagement_count      = COALESCE(a.engagement_count, 0),
    last_email_at         = a.last_email_at,
    last_chat_at          = a.last_chat_at,
    last_chat_staff_at    = a.last_chat_staff_at,
    last_engagement_at    = a.last_engagement_at,
    source_count          = COALESCE(a.source_count, 0)
  FROM agg a
  WHERE d.lead_id = a.lead_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- C. Scoring V7: use REAL engagement signals
DROP FUNCTION IF EXISTS recompute_lead_scores();

CREATE FUNCTION recompute_lead_scores()
RETURNS TABLE (out_lead_id UUID, out_score INT, out_tier TEXT) AS $$
BEGIN
  RETURN QUERY
  WITH
  signals AS (
    SELECT
      l.lead_id AS lid,
      -- Recency flags
      (l.last_chat_at > NOW() - INTERVAL '3 days') AS chat_recent,
      (l.last_chat_staff_at > NOW() - INTERVAL '3 days') AS reply_recent,
      (l.last_email_at > NOW() - INTERVAL '7 days') AS email_recent,
      l.chat_staff_count AS staff_total,
      l.chat_count AS chat_total,
      l.engagement_count AS engagement_total,  -- NEW: excludes lead_created
      l.source_count AS source_count,          -- NEW: only counts engaged sources
      l.conversion_count AS conversions,
      l.email_open_count AS opens,
      l.email_received_count AS emails_sent,

      COALESCE(
        EXTRACT(EPOCH FROM (NOW() - l.last_engagement_at)) / 86400,
        9999
      ) AS silent_days,

      (l.chat_count + l.chat_staff_count + l.email_open_count + l.email_click_count + l.conversion_count) > 0 AS has_engagement
    FROM dim_lead l
    WHERE l.stage != 'Đã chốt'
  ),
  computed AS (
    SELECT
      s.lid,
      s.chat_recent, s.reply_recent, s.email_recent,
      s.staff_total, s.chat_total, s.engagement_total, s.source_count,
      s.conversions, s.opens, s.emails_sent, s.silent_days, s.has_engagement,
      40 +
      -- Real lead chat (not TVV broadcast)
      (CASE WHEN s.chat_recent AND s.chat_total > 0 THEN 35 ELSE 0 END) +
      (CASE WHEN s.reply_recent THEN 20 ELSE 0 END) +
      (CASE WHEN s.email_recent THEN 5 ELSE 0 END) +
      (CASE WHEN s.staff_total >= 5 THEN 15 ELSE 0 END) +
      (CASE WHEN s.engagement_total >= 5 THEN 10 ELSE 0 END) +  -- engagement, not total_touchpoints
      (CASE WHEN s.source_count >= 2 THEN 20 ELSE 0 END) +       -- engaged sources only
      (CASE WHEN s.conversions > 0 THEN 25 ELSE 0 END) +
      (CASE
        WHEN s.emails_sent >= 5 AND s.opens::FLOAT / NULLIF(s.emails_sent, 0) > 0.3 THEN 15
        WHEN s.emails_sent >= 10 AND s.opens = 0 THEN -10
        ELSE 0
      END) +
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
          SELECT jsonb_build_object('sign', '+', 'label', 'Lead chat trong 3 ngày qua', 'points', 35) AS reason
            WHERE c.chat_recent AND c.chat_total > 0
          UNION ALL SELECT jsonb_build_object('sign', '+', 'label', 'TVV reply trong 3 ngày', 'points', 20) WHERE c.reply_recent
          UNION ALL SELECT jsonb_build_object('sign', '+', 'label', 'MDA gửi email trong 7 ngày', 'points', 5) WHERE c.email_recent
          UNION ALL SELECT jsonb_build_object('sign', '+', 'label', 'TVV chat tổng >= 5 lần', 'points', 15) WHERE c.staff_total >= 5
          UNION ALL SELECT jsonb_build_object('sign', '+', 'label', 'Tổng engagement >= 5 (real)', 'points', 10) WHERE c.engagement_total >= 5
          UNION ALL SELECT jsonb_build_object('sign', '+', 'label', 'Đa kênh engaged (>= 2 nguồn thật)', 'points', 20) WHERE c.source_count >= 2
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

GRANT EXECUTE ON FUNCTION recompute_lead_aggregates() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION recompute_lead_scores() TO anon, authenticated;

-- Run both
SELECT 'Recomputing aggregates...' AS step;
SELECT recompute_lead_aggregates() AS aggregates_updated;

SELECT 'Recomputing scores V7...' AS step;
SELECT COUNT(*) AS total_scored FROM recompute_lead_scores();

-- Show new distribution
SELECT 'Tier distribution after V7' AS metric;
SELECT lead_tier(hot_score) AS tier, COUNT(*) AS count, MIN(hot_score) AS min, MAX(hot_score) AS max
FROM fact_lead_score WHERE scored_at = CURRENT_DATE
GROUP BY tier ORDER BY min DESC;
