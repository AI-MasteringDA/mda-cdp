-- ============================================================
-- Scoring V9: Comprehensive intent tracking
-- ------------------------------------------------------------
-- V8 chỉ +35 cho chat, +5 email → BỎ SÓT form_submit, login, email_reply,
-- email_click — những signal INTENT MẠNH mà lead thể hiện.
--
-- V9 tracks ALL genuine intent signals with tiered decay:
--
--   HIGH INTENT (lead-initiated):
--     Chat inbound:  3d:+35  7d:+25  14d:+15  30d:+5
--     Email reply:   3d:+30  7d:+22  14d:+15  30d:+5
--     Email click:   3d:+20  7d:+15  14d:+10  30d:+3
--     Form submit:   3d:+30  7d:+20  14d:+10  30d:+5   ← MISSED IN V8
--     Web login:     3d:+15  7d:+10  30d:+5            ← MISSED IN V8
--
--   MEDIUM INTENT (behavior):
--     Email open:    7d:+5   14d:+3   30d:+1
--
--   TVV outreach (kept):
--     TVV reply:     3d:+20  7d:+15  14d:+10  30d:+3
-- ============================================================

-- 1. Add per-signal timestamp aggregates
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS last_form_submit_at TIMESTAMPTZ;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS last_email_click_at TIMESTAMPTZ;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS last_email_reply_at TIMESTAMPTZ;

ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS form_submit_count INT DEFAULT 0;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS login_count INT DEFAULT 0;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS email_reply_count INT DEFAULT 0;

-- 2. Update recompute_lead_aggregates to include new signals
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
      COUNT(*) FILTER (WHERE event_type = 'email_reply') AS email_reply_count,
      COUNT(*) FILTER (
        WHERE event_type = 'chat'
          AND title NOT ILIKE 'Đã gửi tệp%'
          AND title NOT ILIKE '📎%'
          AND (detail IS NULL OR detail NOT ILIKE 'Không có nội dung text%')
      ) AS chat_count,
      COUNT(*) FILTER (WHERE event_type = 'chat_staff')  AS chat_staff_count,
      COUNT(*) FILTER (WHERE event_type = 'conversion')  AS conversion_count,
      COUNT(*) FILTER (WHERE event_type = 'form_submit') AS form_submit_count,
      COUNT(*) FILTER (WHERE event_type = 'page_view')   AS login_count,
      -- engagement counts LEAD-INITIATED signals + form + login
      COUNT(*) FILTER (
        WHERE event_type IN ('chat','chat_staff','email_open','email_click','email_reply',
                             'call','meeting','form_submit','page_view','conversion')
      ) AS engagement_count,
      MAX(occurred_at) FILTER (WHERE event_type IN ('email_sent','email_open','email_click','email_reply')) AS last_email_at,
      MAX(occurred_at) FILTER (WHERE event_type = 'email_click') AS last_email_click_at,
      MAX(occurred_at) FILTER (WHERE event_type = 'email_reply') AS last_email_reply_at,
      MAX(occurred_at) FILTER (WHERE event_type = 'chat') AS last_chat_at,
      MAX(occurred_at) FILTER (WHERE event_type = 'chat_staff') AS last_chat_staff_at,
      MAX(occurred_at) FILTER (WHERE event_type = 'form_submit') AS last_form_submit_at,
      MAX(occurred_at) FILTER (WHERE event_type = 'page_view') AS last_login_at,
      MAX(occurred_at) FILTER (
        WHERE event_type IN ('chat','chat_staff','email_open','email_click','email_reply',
                             'call','meeting','form_submit','page_view','conversion')
      ) AS last_engagement_at,
      COUNT(DISTINCT source) FILTER (
        WHERE source IN ('smax','salesforce','instantly','web','fanpage')
          AND event_type IN ('chat','chat_staff','email_open','email_click','email_reply',
                             'call','meeting','form_submit','page_view','conversion')
      ) AS source_count
    FROM fact_touchpoint
    GROUP BY lead_id
  )
  UPDATE dim_lead d SET
    total_touchpoints     = COALESCE(a.total_touchpoints, 0),
    email_received_count  = COALESCE(a.email_received_count, 0),
    email_open_count      = COALESCE(a.email_open_count, 0),
    email_click_count     = COALESCE(a.email_click_count, 0),
    email_reply_count     = COALESCE(a.email_reply_count, 0),
    chat_count            = COALESCE(a.chat_count, 0),
    chat_staff_count      = COALESCE(a.chat_staff_count, 0),
    conversion_count      = COALESCE(a.conversion_count, 0),
    form_submit_count     = COALESCE(a.form_submit_count, 0),
    login_count           = COALESCE(a.login_count, 0),
    engagement_count      = COALESCE(a.engagement_count, 0),
    last_email_at         = a.last_email_at,
    last_email_click_at   = a.last_email_click_at,
    last_email_reply_at   = a.last_email_reply_at,
    last_chat_at          = a.last_chat_at,
    last_chat_staff_at    = a.last_chat_staff_at,
    last_form_submit_at   = a.last_form_submit_at,
    last_login_at         = a.last_login_at,
    last_engagement_at    = a.last_engagement_at,
    source_count          = COALESCE(a.source_count, 0)
  FROM agg a
  WHERE d.lead_id = a.lead_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. V9 Scoring function
DROP FUNCTION IF EXISTS recompute_lead_scores();

CREATE FUNCTION recompute_lead_scores()
RETURNS TABLE (out_lead_id UUID, out_score INT, out_tier TEXT) AS $$
BEGIN
  RETURN QUERY
  WITH
  signals AS (
    SELECT
      l.lead_id AS lid,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_chat_at)) / 86400, 9999) AS chat_days,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_chat_staff_at)) / 86400, 9999) AS reply_days,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_email_at)) / 86400, 9999) AS email_days,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_email_click_at)) / 86400, 9999) AS click_days,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_email_reply_at)) / 86400, 9999) AS ereply_days,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_form_submit_at)) / 86400, 9999) AS form_days,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_login_at)) / 86400, 9999) AS login_days,
      l.chat_staff_count AS staff_total,
      l.chat_count AS chat_total,
      l.form_submit_count AS forms_total,
      l.email_reply_count AS ereply_total,
      l.email_click_count AS click_total,
      l.engagement_count AS engagement_total,
      l.source_count AS source_count,
      l.conversion_count AS conversions,
      l.email_open_count AS opens,
      l.email_received_count AS emails_sent,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_engagement_at)) / 86400, 9999) AS silent_days,
      (l.chat_count + l.chat_staff_count + l.email_open_count + l.email_click_count +
       l.email_reply_count + l.form_submit_count + l.login_count + l.conversion_count) > 0 AS has_engagement
    FROM dim_lead l
    WHERE l.stage != 'Đã chốt'
  ),
  computed AS (
    SELECT
      s.*,
      40 +
      -- HIGH INTENT: Lead chat inbound
      (CASE
        WHEN s.chat_total > 0 AND s.chat_days <= 3   THEN 35
        WHEN s.chat_total > 0 AND s.chat_days <= 7   THEN 25
        WHEN s.chat_total > 0 AND s.chat_days <= 14  THEN 15
        WHEN s.chat_total > 0 AND s.chat_days <= 30  THEN 5
        ELSE 0
      END) +
      -- HIGH INTENT: Email reply (lead trả lời email)
      (CASE
        WHEN s.ereply_total > 0 AND s.ereply_days <= 3   THEN 30
        WHEN s.ereply_total > 0 AND s.ereply_days <= 7   THEN 22
        WHEN s.ereply_total > 0 AND s.ereply_days <= 14  THEN 15
        WHEN s.ereply_total > 0 AND s.ereply_days <= 30  THEN 5
        ELSE 0
      END) +
      -- HIGH INTENT: Email click (lead click link)
      (CASE
        WHEN s.click_total > 0 AND s.click_days <= 3   THEN 20
        WHEN s.click_total > 0 AND s.click_days <= 7   THEN 15
        WHEN s.click_total > 0 AND s.click_days <= 14  THEN 10
        WHEN s.click_total > 0 AND s.click_days <= 30  THEN 3
        ELSE 0
      END) +
      -- HIGH INTENT: Form submit
      (CASE
        WHEN s.forms_total > 0 AND s.form_days <= 3   THEN 30
        WHEN s.forms_total > 0 AND s.form_days <= 7   THEN 20
        WHEN s.forms_total > 0 AND s.form_days <= 14  THEN 10
        WHEN s.forms_total > 0 AND s.form_days <= 30  THEN 5
        ELSE 0
      END) +
      -- MEDIUM INTENT: Web login
      (CASE
        WHEN s.login_days <= 3   THEN 15
        WHEN s.login_days <= 7   THEN 10
        WHEN s.login_days <= 30  THEN 5
        ELSE 0
      END) +
      -- MEDIUM INTENT: Email open
      (CASE
        WHEN s.email_days <= 7   THEN 5
        WHEN s.email_days <= 14  THEN 3
        WHEN s.email_days <= 30  THEN 1
        ELSE 0
      END) +
      -- TVV outreach recency
      (CASE
        WHEN s.reply_days <= 3   THEN 20
        WHEN s.reply_days <= 7   THEN 15
        WHEN s.reply_days <= 14  THEN 10
        WHEN s.reply_days <= 30  THEN 3
        ELSE 0
      END) +
      -- Cumulative signals
      (CASE WHEN s.staff_total >= 5 THEN 15 ELSE 0 END) +
      (CASE WHEN s.engagement_total >= 5 THEN 10 ELSE 0 END) +
      (CASE WHEN s.source_count >= 2 THEN 20 ELSE 0 END) +
      (CASE WHEN s.conversions > 0 THEN 25 ELSE 0 END) +
      -- Open rate quality
      (CASE
        WHEN s.emails_sent >= 5 AND s.opens::FLOAT / NULLIF(s.emails_sent, 0) > 0.3 THEN 15
        WHEN s.emails_sent >= 10 AND s.opens = 0 THEN -10
        ELSE 0
      END) +
      -- Silent penalties
      (CASE
        WHEN s.silent_days <= 30 THEN 0
        WHEN s.silent_days <= 90 THEN -20
        WHEN s.silent_days <= 180 THEN -40
        ELSE -60
      END) +
      (CASE WHEN NOT s.has_engagement THEN -10 ELSE 0 END) AS raw_score
    FROM signals s
  ),
  clamped AS (
    SELECT
      c.lid,
      GREATEST(0, LEAST(100, c.raw_score))::INT AS score,
      (
        SELECT jsonb_agg(reason ORDER BY (reason->>'points')::int DESC)
        FROM (
          -- Chat inbound reasons
          SELECT jsonb_build_object('sign','+','label','🔥 Lead chat trong 3 ngày','points',35) AS reason
            WHERE c.chat_total > 0 AND c.chat_days <= 3
          UNION ALL SELECT jsonb_build_object('sign','+','label','🌡 Lead chat trong 7 ngày','points',25)
            WHERE c.chat_total > 0 AND c.chat_days > 3 AND c.chat_days <= 7
          UNION ALL SELECT jsonb_build_object('sign','+','label','☀ Lead chat trong 14 ngày','points',15)
            WHERE c.chat_total > 0 AND c.chat_days > 7 AND c.chat_days <= 14
          UNION ALL SELECT jsonb_build_object('sign','+','label','🌤 Lead chat trong 30 ngày','points',5)
            WHERE c.chat_total > 0 AND c.chat_days > 14 AND c.chat_days <= 30
          -- Email reply
          UNION ALL SELECT jsonb_build_object('sign','+','label','🔥 Lead reply email trong 3 ngày','points',30)
            WHERE c.ereply_total > 0 AND c.ereply_days <= 3
          UNION ALL SELECT jsonb_build_object('sign','+','label','🌡 Lead reply email trong 7 ngày','points',22)
            WHERE c.ereply_total > 0 AND c.ereply_days > 3 AND c.ereply_days <= 7
          UNION ALL SELECT jsonb_build_object('sign','+','label','☀ Lead reply email trong 14 ngày','points',15)
            WHERE c.ereply_total > 0 AND c.ereply_days > 7 AND c.ereply_days <= 14
          UNION ALL SELECT jsonb_build_object('sign','+','label','🌤 Lead reply email trong 30 ngày','points',5)
            WHERE c.ereply_total > 0 AND c.ereply_days > 14 AND c.ereply_days <= 30
          -- Email click
          UNION ALL SELECT jsonb_build_object('sign','+','label','🔥 Lead click email trong 3 ngày','points',20)
            WHERE c.click_total > 0 AND c.click_days <= 3
          UNION ALL SELECT jsonb_build_object('sign','+','label','🌡 Lead click email trong 7 ngày','points',15)
            WHERE c.click_total > 0 AND c.click_days > 3 AND c.click_days <= 7
          UNION ALL SELECT jsonb_build_object('sign','+','label','☀ Lead click email trong 14 ngày','points',10)
            WHERE c.click_total > 0 AND c.click_days > 7 AND c.click_days <= 14
          UNION ALL SELECT jsonb_build_object('sign','+','label','🌤 Lead click email trong 30 ngày','points',3)
            WHERE c.click_total > 0 AND c.click_days > 14 AND c.click_days <= 30
          -- Form submit
          UNION ALL SELECT jsonb_build_object('sign','+','label','🔥 Submit form trong 3 ngày','points',30)
            WHERE c.forms_total > 0 AND c.form_days <= 3
          UNION ALL SELECT jsonb_build_object('sign','+','label','🌡 Submit form trong 7 ngày','points',20)
            WHERE c.forms_total > 0 AND c.form_days > 3 AND c.form_days <= 7
          UNION ALL SELECT jsonb_build_object('sign','+','label','☀ Submit form trong 14 ngày','points',10)
            WHERE c.forms_total > 0 AND c.form_days > 7 AND c.form_days <= 14
          UNION ALL SELECT jsonb_build_object('sign','+','label','🌤 Submit form trong 30 ngày','points',5)
            WHERE c.forms_total > 0 AND c.form_days > 14 AND c.form_days <= 30
          -- Web login
          UNION ALL SELECT jsonb_build_object('sign','+','label','🌐 Login website trong 3 ngày','points',15)
            WHERE c.login_days <= 3
          UNION ALL SELECT jsonb_build_object('sign','+','label','🌐 Login website trong 7 ngày','points',10)
            WHERE c.login_days > 3 AND c.login_days <= 7
          UNION ALL SELECT jsonb_build_object('sign','+','label','🌐 Login website trong 30 ngày','points',5)
            WHERE c.login_days > 7 AND c.login_days <= 30
          -- Email open
          UNION ALL SELECT jsonb_build_object('sign','+','label','MDA email trong 7 ngày','points',5)
            WHERE c.email_days <= 7
          UNION ALL SELECT jsonb_build_object('sign','+','label','MDA email trong 14 ngày','points',3)
            WHERE c.email_days > 7 AND c.email_days <= 14
          UNION ALL SELECT jsonb_build_object('sign','+','label','MDA email trong 30 ngày','points',1)
            WHERE c.email_days > 14 AND c.email_days <= 30
          -- TVV outreach
          UNION ALL SELECT jsonb_build_object('sign','+','label','TVV reply trong 3 ngày','points',20)
            WHERE c.reply_days <= 3
          UNION ALL SELECT jsonb_build_object('sign','+','label','TVV reply trong 7 ngày','points',15)
            WHERE c.reply_days > 3 AND c.reply_days <= 7
          UNION ALL SELECT jsonb_build_object('sign','+','label','TVV reply trong 14 ngày','points',10)
            WHERE c.reply_days > 7 AND c.reply_days <= 14
          UNION ALL SELECT jsonb_build_object('sign','+','label','TVV reply trong 30 ngày','points',3)
            WHERE c.reply_days > 14 AND c.reply_days <= 30
          -- Cumulative
          UNION ALL SELECT jsonb_build_object('sign','+','label','TVV chat tổng >= 5 lần','points',15)
            WHERE c.staff_total >= 5
          UNION ALL SELECT jsonb_build_object('sign','+','label','Tổng engagement >= 5','points',10)
            WHERE c.engagement_total >= 5
          UNION ALL SELECT jsonb_build_object('sign','+','label','Đa kênh engaged (>= 2 nguồn)','points',20)
            WHERE c.source_count >= 2
          UNION ALL SELECT jsonb_build_object('sign','+','label','Đã từng mua khóa khác','points',25)
            WHERE c.conversions > 0
          UNION ALL SELECT jsonb_build_object('sign','+','label','Mở email > 30% (engaged reader)','points',15)
            WHERE c.emails_sent >= 5 AND c.opens::FLOAT / NULLIF(c.emails_sent, 0) > 0.3
          -- Negatives
          UNION ALL SELECT jsonb_build_object('sign','-','label','Nhận nhiều email nhưng không mở','points',10)
            WHERE c.emails_sent >= 10 AND c.opens = 0
          UNION ALL SELECT jsonb_build_object('sign','-','label','Im lặng 30-90 ngày','points',20)
            WHERE c.silent_days > 30 AND c.silent_days <= 90
          UNION ALL SELECT jsonb_build_object('sign','-','label','Im lặng 90-180 ngày','points',40)
            WHERE c.silent_days > 90 AND c.silent_days <= 180
          UNION ALL SELECT jsonb_build_object('sign','-','label','Im lặng > 180 ngày','points',60)
            WHERE c.silent_days > 180
          UNION ALL SELECT jsonb_build_object('sign','-','label','Chưa từng tương tác thật sự','points',10)
            WHERE NOT c.has_engagement
        ) reasons_subq
      ) AS reasons_json
    FROM computed c
  ),
  upserted AS (
    INSERT INTO fact_lead_score (lead_id, scored_at, hot_score, cold_score, hot_reasons, cold_reasons)
    SELECT cl.lid, CURRENT_DATE, cl.score, GREATEST(0, 100 - cl.score),
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

-- 4. Run recompute
SELECT recompute_lead_aggregates() AS aggregates_updated;
SELECT COUNT(*) AS total_scored FROM recompute_lead_scores();

-- 5. Show new distribution
SELECT lead_tier(hot_score) AS tier, COUNT(*) AS count, MIN(hot_score) AS min, MAX(hot_score) AS max
FROM fact_lead_score WHERE scored_at = CURRENT_DATE
GROUP BY tier ORDER BY min DESC;

SELECT '✅ V9 Comprehensive Scoring installed' AS status;
