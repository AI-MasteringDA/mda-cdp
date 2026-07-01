-- ============================================================
-- Scoring V10: Sharpened signal quality
-- ------------------------------------------------------------
-- V9 too generous with weak signals (email open, TVV outreach)
-- V10 principles:
--   - STRONG signals (lead-initiated): full points
--   - MEDIUM signals: half points
--   - WEAK signals: minimal points
--   - Multi-channel bonus ONLY if lead-initiated on 2+ channels
-- ============================================================

DROP FUNCTION IF EXISTS recompute_lead_scores();

CREATE FUNCTION recompute_lead_scores()
RETURNS TABLE (out_lead_id UUID, out_score INT, out_tier TEXT) AS $$
BEGIN
  RETURN QUERY
  WITH signals AS (
    SELECT l.lead_id AS lid,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_chat_at)) / 86400, 9999) AS chat_days,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_chat_staff_at)) / 86400, 9999) AS reply_days,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_email_at)) / 86400, 9999) AS email_days,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_email_click_at)) / 86400, 9999) AS click_days,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_email_reply_at)) / 86400, 9999) AS ereply_days,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_form_submit_at)) / 86400, 9999) AS form_days,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_login_at)) / 86400, 9999) AS login_days,
      l.chat_staff_count AS staff_total, l.chat_count AS chat_total,
      l.form_submit_count AS forms_total, l.email_reply_count AS ereply_total,
      l.email_click_count AS click_total, l.email_open_count AS opens,
      l.email_received_count AS emails_sent, l.conversion_count AS conversions,
      -- LEAD-INITIATED source count (excludes chat_staff which is MDA push)
      (
        SELECT COUNT(DISTINCT ft.source) FROM fact_touchpoint ft
        WHERE ft.lead_id = l.lead_id
          AND ft.source IN ('smax','salesforce','instantly','web','fanpage')
          AND ft.event_type IN ('chat','email_click','email_reply','form_submit','conversion')
      ) AS lead_source_count,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_engagement_at)) / 86400, 9999) AS silent_days,
      (l.chat_count + l.email_click_count + l.email_reply_count + l.form_submit_count + l.conversion_count) > 0 AS has_lead_engagement
    FROM dim_lead l WHERE l.stage != 'Đã chốt'
  ),
  computed AS (
    SELECT s.*, 40 +
      -- 🔥 STRONG: Lead chat inbound
      (CASE WHEN s.chat_total > 0 AND s.chat_days <= 3 THEN 35 WHEN s.chat_total > 0 AND s.chat_days <= 7 THEN 25 WHEN s.chat_total > 0 AND s.chat_days <= 14 THEN 15 WHEN s.chat_total > 0 AND s.chat_days <= 30 THEN 5 ELSE 0 END) +
      -- 🔥 STRONG: Lead email reply
      (CASE WHEN s.ereply_total > 0 AND s.ereply_days <= 3 THEN 30 WHEN s.ereply_total > 0 AND s.ereply_days <= 7 THEN 22 WHEN s.ereply_total > 0 AND s.ereply_days <= 14 THEN 15 WHEN s.ereply_total > 0 AND s.ereply_days <= 30 THEN 5 ELSE 0 END) +
      -- 🔥 STRONG: Lead email click
      (CASE WHEN s.click_total > 0 AND s.click_days <= 3 THEN 25 WHEN s.click_total > 0 AND s.click_days <= 7 THEN 18 WHEN s.click_total > 0 AND s.click_days <= 14 THEN 10 WHEN s.click_total > 0 AND s.click_days <= 30 THEN 3 ELSE 0 END) +
      -- 🔥 STRONG: Form submit
      (CASE WHEN s.forms_total > 0 AND s.form_days <= 3 THEN 30 WHEN s.forms_total > 0 AND s.form_days <= 7 THEN 20 WHEN s.forms_total > 0 AND s.form_days <= 14 THEN 10 WHEN s.forms_total > 0 AND s.form_days <= 30 THEN 5 ELSE 0 END) +
      -- 🌡 MEDIUM: Login recent
      (CASE WHEN s.login_days <= 3 THEN 15 WHEN s.login_days <= 7 THEN 10 WHEN s.login_days <= 30 THEN 5 ELSE 0 END) +
      -- ☀ WEAK: Email open (reduced points, multiple opens = bonus)
      (CASE
        WHEN s.opens >= 3 AND s.email_days <= 7 THEN 8    -- persistent interest
        WHEN s.email_days <= 7 THEN 2                     -- single open (weak)
        WHEN s.email_days <= 14 THEN 1
        ELSE 0
      END) +
      -- ☀ WEAK: TVV outreach recency (reduced from +20 — this is MDA push, not lead intent)
      (CASE
        WHEN s.reply_days <= 3 THEN 10
        WHEN s.reply_days <= 7 THEN 7
        WHEN s.reply_days <= 14 THEN 4
        WHEN s.reply_days <= 30 THEN 2
        ELSE 0
      END) +
      -- 🌡 MEDIUM: LEAD-initiated multi-channel (STRICT: chỉ đếm lead actions)
      (CASE
        WHEN s.lead_source_count >= 3 THEN 30
        WHEN s.lead_source_count >= 2 THEN 20
        ELSE 0
      END) +
      -- Cumulative TVV interaction (long history)
      (CASE WHEN s.staff_total >= 10 THEN 10 ELSE 0 END) +
      -- Historical conversion (repeat customer intent)
      (CASE WHEN s.conversions > 0 THEN 25 ELSE 0 END) +
      -- Open rate quality (high engagement)
      (CASE
        WHEN s.emails_sent >= 5 AND s.opens::FLOAT / NULLIF(s.emails_sent, 0) > 0.3 THEN 12
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
      -- No LEAD engagement penalty (stricter than V9)
      (CASE WHEN NOT s.has_lead_engagement THEN -15 ELSE 0 END) AS raw_score
    FROM signals s
  ),
  clamped AS (
    SELECT c.lid, GREATEST(0, LEAST(100, c.raw_score))::INT AS score,
      (SELECT jsonb_agg(reason ORDER BY (reason->>'points')::int DESC) FROM (
        -- Strong lead signals
        SELECT jsonb_build_object('sign','+','label','🔥 Lead chat trong 3 ngày','points',35) AS reason WHERE c.chat_total > 0 AND c.chat_days <= 3
        UNION ALL SELECT jsonb_build_object('sign','+','label','🔥 Lead reply email 3 ngày','points',30) WHERE c.ereply_total > 0 AND c.ereply_days <= 3
        UNION ALL SELECT jsonb_build_object('sign','+','label','🔥 Lead click email 3 ngày','points',25) WHERE c.click_total > 0 AND c.click_days <= 3
        UNION ALL SELECT jsonb_build_object('sign','+','label','🔥 Submit form 3 ngày','points',30) WHERE c.forms_total > 0 AND c.form_days <= 3
        UNION ALL SELECT jsonb_build_object('sign','+','label','🌡 Submit form 7 ngày','points',20) WHERE c.forms_total > 0 AND c.form_days > 3 AND c.form_days <= 7
        UNION ALL SELECT jsonb_build_object('sign','+','label','🌐 Login recent','points',15) WHERE c.login_days <= 3
        -- Weak signals (reduced points)
        UNION ALL SELECT jsonb_build_object('sign','+','label','📧 Mở email nhiều lần (>=3)','points',8) WHERE c.opens >= 3 AND c.email_days <= 7
        UNION ALL SELECT jsonb_build_object('sign','+','label','📧 Mở email 1 lần (weak signal)','points',2) WHERE c.opens < 3 AND c.email_days <= 7
        UNION ALL SELECT jsonb_build_object('sign','+','label','💬 TVV vừa chat (push signal)','points',10) WHERE c.reply_days <= 3
        UNION ALL SELECT jsonb_build_object('sign','+','label','💬 TVV chat trong tuần','points',7) WHERE c.reply_days > 3 AND c.reply_days <= 7
        -- Multi-channel LEAD (strict definition)
        UNION ALL SELECT jsonb_build_object('sign','+','label','🎯 LEAD engaged 3+ nguồn','points',30) WHERE c.lead_source_count >= 3
        UNION ALL SELECT jsonb_build_object('sign','+','label','🎯 LEAD engaged 2 nguồn','points',20) WHERE c.lead_source_count = 2
        -- Cumulative
        UNION ALL SELECT jsonb_build_object('sign','+','label','🏆 Repeat customer','points',25) WHERE c.conversions > 0
        UNION ALL SELECT jsonb_build_object('sign','+','label','⭐ Open rate > 30%','points',12) WHERE c.emails_sent >= 5 AND c.opens::FLOAT / NULLIF(c.emails_sent, 0) > 0.3
        -- Negatives
        UNION ALL SELECT jsonb_build_object('sign','-','label','😴 Im lặng 30-90 ngày','points',20) WHERE c.silent_days > 30 AND c.silent_days <= 90
        UNION ALL SELECT jsonb_build_object('sign','-','label','😴 Im lặng 90-180 ngày','points',40) WHERE c.silent_days > 90 AND c.silent_days <= 180
        UNION ALL SELECT jsonb_build_object('sign','-','label','😴 Im lặng > 180 ngày','points',60) WHERE c.silent_days > 180
        UNION ALL SELECT jsonb_build_object('sign','-','label','❌ Chưa có LEAD engagement thật','points',15) WHERE NOT c.has_lead_engagement
        UNION ALL SELECT jsonb_build_object('sign','-','label','📭 Nhận email không mở','points',10) WHERE c.emails_sent >= 10 AND c.opens = 0
      ) reasons_subq) AS reasons_json
    FROM computed c
  ),
  upserted AS (
    INSERT INTO fact_lead_score (lead_id, scored_at, hot_score, cold_score, hot_reasons, cold_reasons)
    SELECT cl.lid, CURRENT_DATE, cl.score, GREATEST(0, 100 - cl.score), COALESCE(cl.reasons_json, '[]'::jsonb), '[]'::jsonb
    FROM clamped cl
    ON CONFLICT (lead_id, scored_at) DO UPDATE SET
      hot_score = EXCLUDED.hot_score, cold_score = EXCLUDED.cold_score,
      hot_reasons = EXCLUDED.hot_reasons, cold_reasons = EXCLUDED.cold_reasons
    RETURNING fact_lead_score.lead_id, fact_lead_score.hot_score
  )
  SELECT u.lead_id, u.hot_score, lead_tier(u.hot_score) FROM upserted u;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION recompute_lead_scores() TO anon, authenticated;

SELECT COUNT(*) FROM recompute_lead_scores();

SELECT lead_tier(hot_score) AS tier, COUNT(*) AS count, MIN(hot_score) AS min, MAX(hot_score) AS max
FROM fact_lead_score WHERE scored_at = CURRENT_DATE
GROUP BY tier ORDER BY min DESC;
