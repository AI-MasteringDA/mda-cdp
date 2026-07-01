-- ============================================================
-- UNIQUE indexes for fact_touchpoint Salesforce rows
-- ------------------------------------------------------------
-- Safety net: even if ETL bug regresses, DB will reject duplicate inserts
-- because of these partial UNIQUE indexes.
--
-- Run AFTER dedupe completes (UNIQUE creation fails on duplicate data).
-- ============================================================

-- Task duplicates: (lead_id, task_id) must be unique
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sf_task_per_lead
  ON fact_touchpoint (lead_id, (payload->>'task_id'))
  WHERE source = 'salesforce' AND payload->>'task_id' IS NOT NULL;

-- Opportunity (conversion/lost) duplicates
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sf_opportunity_per_lead
  ON fact_touchpoint (lead_id, (payload->>'opportunity_id'))
  WHERE source = 'salesforce' AND payload->>'opportunity_id' IS NOT NULL;

-- Contact creation duplicates
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sf_contact_per_lead
  ON fact_touchpoint (lead_id, (payload->>'sf_contact_id'))
  WHERE source = 'salesforce' AND payload->>'sf_contact_id' IS NOT NULL;

-- Lead creation duplicates
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sf_lead_per_lead
  ON fact_touchpoint (lead_id, (payload->>'sf_lead_id'))
  WHERE source = 'salesforce' AND payload->>'sf_lead_id' IS NOT NULL;

NOTIFY pgrst, 'reload schema';
