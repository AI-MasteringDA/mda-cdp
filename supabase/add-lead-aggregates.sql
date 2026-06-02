-- ============================================================
-- Lead Aggregates: pre-computed metrics per lead for fast queries
-- ------------------------------------------------------------
-- Vấn đề: mỗi lần load lead detail → JOIN fact_touchpoint → đếm
-- email/chat/conversion → chậm khi DB lớn. Mỗi lần tính scoring
-- cũng phải re-scan touchpoints.
--
-- Giải pháp: cache aggregates trên dim_lead. Update khi:
--   1. ETL insert touchpoints mới (trigger)
--   2. SCORING recompute (manual call)
-- ============================================================

ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS total_touchpoints INT DEFAULT 0;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS email_received_count INT DEFAULT 0;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS email_open_count INT DEFAULT 0;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS email_click_count INT DEFAULT 0;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS chat_count INT DEFAULT 0;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS chat_staff_count INT DEFAULT 0;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS conversion_count INT DEFAULT 0;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS web_page_view_count INT DEFAULT 0;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS last_email_at TIMESTAMPTZ;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS last_chat_at TIMESTAMPTZ;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS last_chat_staff_at TIMESTAMPTZ;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS last_engagement_at TIMESTAMPTZ;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS source_count INT DEFAULT 0;

-- Backfill function: compute aggregates from fact_touchpoint
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
      MAX(occurred_at) FILTER (WHERE event_type IN ('email_sent','email_open','email_click','email_reply')) AS last_email_at,
      MAX(occurred_at) FILTER (WHERE event_type = 'chat')                AS last_chat_at,
      MAX(occurred_at) FILTER (WHERE event_type = 'chat_staff')          AS last_chat_staff_at,
      MAX(occurred_at) FILTER (
        WHERE event_type IN ('chat','chat_staff','email_open','email_click','email_reply','call','meeting','form_submit','page_view','conversion')
      ) AS last_engagement_at,
      COUNT(DISTINCT source) FILTER (
        WHERE source IN ('smax','salesforce','instantly','web','fanpage')
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

GRANT EXECUTE ON FUNCTION recompute_lead_aggregates() TO anon, authenticated;

-- Run initial backfill
SELECT 'Running initial backfill...' AS step;
SELECT recompute_lead_aggregates() AS leads_updated;

-- Verify: sample 5 leads with multi-source / engagement
SELECT 'Sample top engagement leads' AS step;
SELECT full_name, total_touchpoints, email_received_count, chat_count, chat_staff_count, conversion_count, source_count
FROM dim_lead
WHERE conversion_count > 0 OR chat_count > 0
ORDER BY total_touchpoints DESC
LIMIT 5;

SELECT '✅ Aggregate columns added + backfilled.' AS status;
