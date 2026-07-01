-- ============================================================
-- Scoring V8: Tiered decay recency scoring
-- ------------------------------------------------------------
-- V7 dùng binary 3-day cutoff → chỉ 3 hot leads (quá strict cho 30-day data).
-- V8 dùng tiered decay: chat 3d/7d/14d/30d với điểm giảm dần → capture nhiều
-- actionable leads hơn mà vẫn phân được urgency.
--
-- Tier decay per signal:
--   Chat lead:     3d:+35  7d:+25  14d:+15  30d:+5   >30d:0
--   TVV reply:     3d:+20  7d:+15  14d:+10  30d:+3   >30d:0
--   Email opens:   7d:+5   14d:+3  30d:+1  >30d:0
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
      -- Days since each signal (NULL → 9999 for math safety)
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_chat_at)) / 86400, 9999) AS chat_days,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_chat_staff_at)) / 86400, 9999) AS reply_days,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_email_at)) / 86400, 9999) AS email_days,
      l.chat_staff_count AS staff_total,
      l.chat_count AS chat_total,
      l.engagement_count AS engagement_total,
      l.source_count AS source_count,
      l.conversion_count AS conversions,
      l.email_open_count AS opens,
      l.email_received_count AS emails_sent,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_engagement_at)) / 86400, 9999) AS silent_days,
      (l.chat_count + l.chat_staff_count + l.email_open_count + l.email_click_count + l.conversion_count) > 0 AS has_engagement
    FROM dim_lead l
    WHERE l.stage != 'Đã chốt'
  ),
  computed AS (
    SELECT
      s.*,
      40 +
      -- TIERED: Lead chat decay (must have chat_total > 0)
      (CASE
        WHEN s.chat_total > 0 AND s.chat_days <= 3   THEN 35
        WHEN s.chat_total > 0 AND s.chat_days <= 7   THEN 25
        WHEN s.chat_total > 0 AND s.chat_days <= 14  THEN 15
        WHEN s.chat_total > 0 AND s.chat_days <= 30  THEN 5
        ELSE 0
      END) +
      -- TIERED: TVV reply decay
      (CASE
        WHEN s.reply_days <= 3   THEN 20
        WHEN s.reply_days <= 7   THEN 15
        WHEN s.reply_days <= 14  THEN 10
        WHEN s.reply_days <= 30  THEN 3
        ELSE 0
      END) +
      -- TIERED: Email opens decay (MDA gửi email được lead engage)
      (CASE
        WHEN s.email_days <= 7   THEN 5
        WHEN s.email_days <= 14  THEN 3
        WHEN s.email_days <= 30  THEN 1
        ELSE 0
      END) +
      -- Cumulative signals (unchanged from V7)
      (CASE WHEN s.staff_total >= 5 THEN 15 ELSE 0 END) +
      (CASE WHEN s.engagement_total >= 5 THEN 10 ELSE 0 END) +
      (CASE WHEN s.source_count >= 2 THEN 20 ELSE 0 END) +
      (CASE WHEN s.conversions > 0 THEN 25 ELSE 0 END) +
      -- Open rate quality (unchanged)
      (CASE
        WHEN s.emails_sent >= 5 AND s.opens::FLOAT / NULLIF(s.emails_sent, 0) > 0.3 THEN 15
        WHEN s.emails_sent >= 10 AND s.opens = 0 THEN -10
        ELSE 0
      END) +
      -- Silent penalties (unchanged)
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
          -- Lead chat tiered reasons (mutually exclusive)
          SELECT jsonb_build_object('sign','+','label','🔥 Lead chat trong 3 ngày','points',35) AS reason
            WHERE c.chat_total > 0 AND c.chat_days <= 3
          UNION ALL SELECT jsonb_build_object('sign','+','label','🌡 Lead chat trong 7 ngày','points',25)
            WHERE c.chat_total > 0 AND c.chat_days > 3 AND c.chat_days <= 7
          UNION ALL SELECT jsonb_build_object('sign','+','label','☀ Lead chat trong 14 ngày','points',15)
            WHERE c.chat_total > 0 AND c.chat_days > 7 AND c.chat_days <= 14
          UNION ALL SELECT jsonb_build_object('sign','+','label','🌤 Lead chat trong 30 ngày','points',5)
            WHERE c.chat_total > 0 AND c.chat_days > 14 AND c.chat_days <= 30
          -- TVV reply tiered reasons
          UNION ALL SELECT jsonb_build_object('sign','+','label','TVV reply trong 3 ngày','points',20)
            WHERE c.reply_days <= 3
          UNION ALL SELECT jsonb_build_object('sign','+','label','TVV reply trong 7 ngày','points',15)
            WHERE c.reply_days > 3 AND c.reply_days <= 7
          UNION ALL SELECT jsonb_build_object('sign','+','label','TVV reply trong 14 ngày','points',10)
            WHERE c.reply_days > 7 AND c.reply_days <= 14
          UNION ALL SELECT jsonb_build_object('sign','+','label','TVV reply trong 30 ngày','points',3)
            WHERE c.reply_days > 14 AND c.reply_days <= 30
          -- Email tiered reasons
          UNION ALL SELECT jsonb_build_object('sign','+','label','MDA email trong 7 ngày','points',5)
            WHERE c.email_days <= 7
          UNION ALL SELECT jsonb_build_object('sign','+','label','MDA email trong 14 ngày','points',3)
            WHERE c.email_days > 7 AND c.email_days <= 14
          UNION ALL SELECT jsonb_build_object('sign','+','label','MDA email trong 30 ngày','points',1)
            WHERE c.email_days > 14 AND c.email_days <= 30
          -- Cumulative signals
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

GRANT EXECUTE ON FUNCTION recompute_lead_scores() TO anon, authenticated;

SELECT '✅ V8 Tiered Decay Scoring installed' AS status;
