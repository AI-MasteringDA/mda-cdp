-- ============================================================
-- FIX: Empty "chat" events were inflating Lead chat score
-- ------------------------------------------------------------
-- Problem: Lead Thúy An scored 100 NÓNG because of +35 "Lead chat trong 3 ngày"
-- but the only chat event was an empty file-only message with no text.
-- Many other leads likely have the same false positive.
--
-- This script:
--   A. Reclassifies empty-text "chat" events → "attachment" type
--   B. Updates recompute_lead_aggregates() to filter empty chats out of chat_count
--   C. Re-runs aggregates + scores
--   D. Reports before/after impact
-- ============================================================

-- ── A. Snapshot BEFORE for reporting
CREATE TEMP TABLE IF NOT EXISTS _fix_before AS
SELECT
  'Lead chat events' AS metric,
  COUNT(*) AS value
FROM fact_touchpoint WHERE event_type = 'chat'
UNION ALL
SELECT 'Empty/file-only chat (will reclassify)', COUNT(*)
FROM fact_touchpoint
WHERE event_type = 'chat'
  AND (
    title ILIKE 'Đã gửi tệp%'
    OR title ILIKE '📎%'
    OR title ILIKE 'Chat: 📎%'
    OR title ILIKE 'Chat: Đã gửi tệp%'
    OR detail ILIKE 'Không có nội dung text%'
  )
UNION ALL
SELECT 'NÓNG leads', COUNT(*)
FROM fact_lead_score
WHERE scored_at = CURRENT_DATE AND hot_score >= 70;

SELECT 'BEFORE FIX' AS step;
SELECT * FROM _fix_before;

-- ── B. Reclassify empty-text "chat" → "attachment"
-- Criteria: title indicates file/attachment, OR detail explicitly says no text
UPDATE fact_touchpoint
SET
  event_type = 'attachment',
  title = CASE
    WHEN title ILIKE 'Chat: 📎%'           THEN REPLACE(title, 'Chat: ', '')
    WHEN title ILIKE 'Chat: Đã gửi tệp%'   THEN REPLACE(title, 'Chat: ', '📎 ')
    WHEN title ILIKE 'Đã gửi tệp%'         THEN '📎 ' || title
    ELSE title
  END
WHERE event_type = 'chat'
  AND (
    title ILIKE 'Đã gửi tệp%'
    OR title ILIKE '📎%'
    OR title ILIKE 'Chat: 📎%'
    OR title ILIKE 'Chat: Đã gửi tệp%'
    OR detail ILIKE 'Không có nội dung text%'
  );

SELECT 'After reclassify — new chat counts' AS step;
SELECT event_type, COUNT(*) FROM fact_touchpoint
WHERE source = 'smax'
GROUP BY event_type
ORDER BY event_type;

-- ── C. Tighten recompute_lead_aggregates: only count chats with actual content
-- This is a safety net for any future ETL that misses the reclassification.
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
      -- TIGHTENED: only count chats with real text content
      COUNT(*) FILTER (
        WHERE event_type = 'chat'
          AND title NOT ILIKE 'Đã gửi tệp%'
          AND title NOT ILIKE '📎%'
          AND title NOT ILIKE 'Chat: 📎%'
          AND title NOT ILIKE 'Chat: Đã gửi tệp%'
          AND (detail IS NULL OR detail NOT ILIKE 'Không có nội dung text%')
      ) AS chat_count,
      COUNT(*) FILTER (WHERE event_type = 'chat_staff')  AS chat_staff_count,
      COUNT(*) FILTER (WHERE event_type = 'conversion')  AS conversion_count,
      COUNT(*) FILTER (WHERE event_type = 'page_view')   AS web_page_view_count,
      COUNT(*) FILTER (
        WHERE event_type IN ('chat','chat_staff','email_open','email_click','email_reply','call','meeting','form_submit','page_view','conversion')
      ) AS engagement_count,
      MAX(occurred_at) FILTER (WHERE event_type IN ('email_sent','email_open','email_click','email_reply')) AS last_email_at,
      -- TIGHTENED: last_chat_at only considers chats with real text content
      MAX(occurred_at) FILTER (
        WHERE event_type = 'chat'
          AND title NOT ILIKE 'Đã gửi tệp%'
          AND title NOT ILIKE '📎%'
          AND title NOT ILIKE 'Chat: 📎%'
          AND title NOT ILIKE 'Chat: Đã gửi tệp%'
          AND (detail IS NULL OR detail NOT ILIKE 'Không có nội dung text%')
      ) AS last_chat_at,
      MAX(occurred_at) FILTER (WHERE event_type = 'chat_staff')          AS last_chat_staff_at,
      MAX(occurred_at) FILTER (
        WHERE event_type IN ('chat','chat_staff','email_open','email_click','email_reply','call','meeting','form_submit','page_view','conversion')
      ) AS last_engagement_at,
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

-- ── D. Recompute aggregates + scores
SELECT 'Recomputing aggregates...' AS step;
SELECT recompute_lead_aggregates() AS aggregates_updated;

SELECT 'Recomputing scores...' AS step;
SELECT COUNT(*) AS total_scored FROM recompute_lead_scores();

-- ── E. AFTER snapshot + impact report
SELECT 'AFTER FIX' AS step;
SELECT
  'Lead chat events (real)' AS metric,
  COUNT(*) AS value
FROM fact_touchpoint WHERE event_type = 'chat'
UNION ALL
SELECT 'Attachment events', COUNT(*) FROM fact_touchpoint WHERE event_type = 'attachment'
UNION ALL
SELECT 'NÓNG leads', COUNT(*)
FROM fact_lead_score
WHERE scored_at = CURRENT_DATE AND hot_score >= 70;

-- New tier distribution
SELECT 'New tier distribution' AS step;
SELECT lead_tier(hot_score) AS tier, COUNT(*) AS count, MIN(hot_score) AS min, MAX(hot_score) AS max
FROM fact_lead_score WHERE scored_at = CURRENT_DATE
GROUP BY tier ORDER BY min DESC;

-- Verify Thúy An specifically (eaf1252d-ac68-47f3-9779-a5df9600ee22)
SELECT 'Thúy An verification' AS step;
SELECT
  d.full_name,
  d.chat_count AS new_chat_count,
  d.chat_staff_count,
  d.last_chat_at,
  s.hot_score,
  s.hot_reasons
FROM dim_lead d
LEFT JOIN fact_lead_score s ON s.lead_id = d.lead_id AND s.scored_at = CURRENT_DATE
WHERE d.lead_id = 'eaf1252d-ac68-47f3-9779-a5df9600ee22';
