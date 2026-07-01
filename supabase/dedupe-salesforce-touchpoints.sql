-- ============================================================
-- Delete duplicate Salesforce touchpoints
-- ------------------------------------------------------------
-- Bug: SF ETL dedup logic chỉ check 1000 row đầu → mỗi cron run
-- insert lại cùng SF tasks/opportunities → 100k+ duplicate rows.
--
-- Strategy: giữ row có id thấp nhất (oldest insert) cho mỗi
-- (source='salesforce', payload->>task_id) combo. Tương tự cho
-- opportunity_id, sf_contact_id, sf_lead_id.
-- ============================================================

-- Snapshot BEFORE
SELECT 'BEFORE' AS phase, COUNT(*) AS sf_touchpoints
FROM fact_touchpoint WHERE source = 'salesforce';

SELECT 'BY event_type BEFORE' AS phase, event_type, COUNT(*)
FROM fact_touchpoint WHERE source = 'salesforce'
GROUP BY event_type ORDER BY COUNT(*) DESC;

-- ── Delete duplicates by task_id (keep MIN id, drop others)
WITH dups AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY lead_id, payload->>'task_id'
           ORDER BY id
         ) AS rn
  FROM fact_touchpoint
  WHERE source = 'salesforce'
    AND payload->>'task_id' IS NOT NULL
)
DELETE FROM fact_touchpoint
WHERE id IN (SELECT id FROM dups WHERE rn > 1);

-- ── Delete duplicates by opportunity_id
WITH dups AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY lead_id, payload->>'opportunity_id'
           ORDER BY id
         ) AS rn
  FROM fact_touchpoint
  WHERE source = 'salesforce'
    AND payload->>'opportunity_id' IS NOT NULL
)
DELETE FROM fact_touchpoint
WHERE id IN (SELECT id FROM dups WHERE rn > 1);

-- ── Delete duplicates by sf_contact_id (lead_created from Contact)
WITH dups AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY lead_id, payload->>'sf_contact_id'
           ORDER BY id
         ) AS rn
  FROM fact_touchpoint
  WHERE source = 'salesforce'
    AND payload->>'sf_contact_id' IS NOT NULL
)
DELETE FROM fact_touchpoint
WHERE id IN (SELECT id FROM dups WHERE rn > 1);

-- ── Delete duplicates by sf_lead_id (lead_created from Lead)
WITH dups AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY lead_id, payload->>'sf_lead_id'
           ORDER BY id
         ) AS rn
  FROM fact_touchpoint
  WHERE source = 'salesforce'
    AND payload->>'sf_lead_id' IS NOT NULL
)
DELETE FROM fact_touchpoint
WHERE id IN (SELECT id FROM dups WHERE rn > 1);

-- Snapshot AFTER
SELECT 'AFTER' AS phase, COUNT(*) AS sf_touchpoints
FROM fact_touchpoint WHERE source = 'salesforce';

SELECT 'BY event_type AFTER' AS phase, event_type, COUNT(*)
FROM fact_touchpoint WHERE source = 'salesforce'
GROUP BY event_type ORDER BY COUNT(*) DESC;

-- ── UNIQUE indexes for safety net — prevent future duplicates at DB level.
-- Partial indexes: only enforce on SF rows where the ID field exists.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sf_task_per_lead
  ON fact_touchpoint (lead_id, (payload->>'task_id'))
  WHERE source = 'salesforce' AND payload->>'task_id' IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_sf_opportunity_per_lead
  ON fact_touchpoint (lead_id, (payload->>'opportunity_id'))
  WHERE source = 'salesforce' AND payload->>'opportunity_id' IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_sf_contact_per_lead
  ON fact_touchpoint (lead_id, (payload->>'sf_contact_id'))
  WHERE source = 'salesforce' AND payload->>'sf_contact_id' IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_sf_lead_per_lead
  ON fact_touchpoint (lead_id, (payload->>'sf_lead_id'))
  WHERE source = 'salesforce' AND payload->>'sf_lead_id' IS NOT NULL;

-- Recompute aggregates after dedup
SELECT recompute_lead_aggregates() AS leads_aggregated;
SELECT COUNT(*) AS leads_scored FROM recompute_lead_scores();

NOTIFY pgrst, 'reload schema';
