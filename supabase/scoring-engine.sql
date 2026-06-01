-- ============================================================
-- MDA Platform — Scoring Engine V1 (rule-based, SQL function)
-- ------------------------------------------------------------
-- Idempotent: chạy nhiều lần OK (DROP + CREATE).
-- ============================================================

DROP FUNCTION IF EXISTS recompute_lead_scores();

CREATE FUNCTION recompute_lead_scores()
RETURNS TABLE (out_lead_id UUID, out_hot INT, out_cold INT) AS $$
BEGIN
  RETURN QUERY
  WITH
  signals AS (
    SELECT
      l.lead_id AS lid,
      COUNT(*) FILTER (
        WHERE t.event_type = 'email_open'
        AND t.occurred_at > NOW() - INTERVAL '7 days'
      ) AS email_open_count,
      COUNT(*) FILTER (
        WHERE t.event_type = 'email_click'
        AND t.occurred_at > NOW() - INTERVAL '7 days'
      ) AS email_click_count,
      COUNT(*) FILTER (
        WHERE t.event_type = 'page_view'
        AND (t.title ILIKE '%bảng giá%' OR t.detail ILIKE '%pricing%')
        AND t.occurred_at > NOW() - INTERVAL '7 days'
      ) AS page_view_pricing,
      COUNT(*) FILTER (
        WHERE t.event_type = 'chat'
        AND t.occurred_at > NOW() - INTERVAL '7 days'
      ) AS chat_initiated_count,
      COUNT(*) FILTER (
        WHERE t.event_type = 'form_submit'
        AND t.occurred_at > NOW() - INTERVAL '7 days'
      ) AS form_submit_count,
      EXTRACT(EPOCH FROM (NOW() - COALESCE(l.last_touch_at, l.first_seen_at))) / 86400 AS days_since_last_contact,
      0::INT AS email_open_rate_drop,
      0::INT AS deal_stage_age_days
    FROM dim_lead l
    LEFT JOIN fact_touchpoint t ON t.lead_id = l.lead_id
    GROUP BY l.lead_id, l.last_touch_at, l.first_seen_at
  ),
  rule_matches AS (
    SELECT
      s.lid,
      r.variant,
      r.weight,
      r.signal_label,
      CASE r.signal
        WHEN 'email_open_count'        THEN s.email_open_count
        WHEN 'email_click_count'       THEN s.email_click_count
        WHEN 'page_view_pricing'       THEN s.page_view_pricing
        WHEN 'chat_initiated_count'    THEN s.chat_initiated_count
        WHEN 'form_submit'             THEN s.form_submit_count
        WHEN 'days_since_last_contact' THEN s.days_since_last_contact
        WHEN 'email_open_rate_drop'    THEN s.email_open_rate_drop
        WHEN 'deal_stage_age_days'     THEN s.deal_stage_age_days
        ELSE 0
      END AS signal_value,
      r.operator,
      r.threshold
    FROM signals s
    CROSS JOIN scoring_rule r
    WHERE r.enabled = true
  ),
  matched AS (
    SELECT
      rm.lid,
      rm.variant,
      rm.weight,
      rm.signal_label
    FROM rule_matches rm
    WHERE
      (rm.operator = '>'  AND rm.signal_value > rm.threshold)  OR
      (rm.operator = '>=' AND rm.signal_value >= rm.threshold) OR
      (rm.operator = '<'  AND rm.signal_value < rm.threshold)  OR
      (rm.operator = '<=' AND rm.signal_value <= rm.threshold) OR
      (rm.operator = '='  AND rm.signal_value = rm.threshold)
  ),
  totals AS (
    SELECT
      m.lid,
      LEAST(100, COALESCE(SUM(CASE WHEN m.variant = 'hot'  THEN m.weight END), 0))::INT AS hot_score,
      LEAST(100, COALESCE(SUM(CASE WHEN m.variant = 'cold' THEN m.weight END), 0))::INT AS cold_score,
      COALESCE(jsonb_agg(m.signal_label) FILTER (WHERE m.variant = 'hot'),  '[]'::jsonb) AS hot_reasons,
      COALESCE(jsonb_agg(m.signal_label) FILTER (WHERE m.variant = 'cold'), '[]'::jsonb) AS cold_reasons
    FROM matched m
    GROUP BY m.lid
  ),
  final_scores AS (
    SELECT
      l.lead_id AS lid,
      COALESCE(t.hot_score, 0) AS hot_score,
      COALESCE(t.cold_score, 0) AS cold_score,
      COALESCE(t.hot_reasons, '[]'::jsonb) AS hot_reasons,
      COALESCE(t.cold_reasons, '[]'::jsonb) AS cold_reasons
    FROM dim_lead l
    LEFT JOIN totals t ON t.lid = l.lead_id
  ),
  upserted AS (
    INSERT INTO fact_lead_score (lead_id, scored_at, hot_score, cold_score, hot_reasons, cold_reasons)
    SELECT
      fs.lid,
      CURRENT_DATE,
      fs.hot_score,
      fs.cold_score,
      fs.hot_reasons,
      fs.cold_reasons
    FROM final_scores fs
    ON CONFLICT (lead_id, scored_at) DO UPDATE SET
      hot_score    = EXCLUDED.hot_score,
      cold_score   = EXCLUDED.cold_score,
      hot_reasons  = EXCLUDED.hot_reasons,
      cold_reasons = EXCLUDED.cold_reasons
    RETURNING fact_lead_score.lead_id, fact_lead_score.hot_score, fact_lead_score.cold_score
  )
  SELECT u.lead_id, u.hot_score, u.cold_score FROM upserted u;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION recompute_lead_scores() TO anon, authenticated;

-- Chạy lần đầu để recompute toàn bộ
SELECT * FROM recompute_lead_scores();
