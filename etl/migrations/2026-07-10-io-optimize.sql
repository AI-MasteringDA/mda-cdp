-- ═══════════════════════════════════════════════════════════════════
-- IO-optimization migration — run in Supabase SQL Editor when DB healthy.
-- Run each statement ONE AT A TIME (top to bottom). Safe to re-run.
--
-- Fixes:
--   1. Missing indexes → every ETL query was a full-table scan of 72k rows
--   2. No unique constraint → duplicate touchpoints piled up (72k vs ~35k real)
--   3. No server-side aggregation → Lark push downloaded everything to Node
-- ═══════════════════════════════════════════════════════════════════

-- ── Step 1: core indexes ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ft_source_lead_ts
  ON fact_touchpoint(source, lead_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_ft_source_ts
  ON fact_touchpoint(source, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_ft_lead_id
  ON fact_touchpoint(lead_id);

-- ── Step 2: dedup key column ─────────────────────────────────────────
-- A real column (not an expression) so PostgREST upsert can target it with
-- ON CONFLICT. Value = SMAX message_id (per-message rows) else thread_id.
ALTER TABLE fact_touchpoint ADD COLUMN IF NOT EXISTS dedup_key TEXT;

-- Backfill server-side (no egress). May take ~1 min on 72k rows.
UPDATE fact_touchpoint
SET dedup_key = COALESCE(payload->>'message_id', payload->>'thread_id')
WHERE source = 'smax' AND dedup_key IS NULL;

-- ── Step 3: delete duplicates (keep newest occurred_at per key) ──────
-- Check how many dups first (optional):
--   SELECT COUNT(*) - COUNT(DISTINCT dedup_key) FROM fact_touchpoint
--   WHERE source='smax' AND dedup_key IS NOT NULL;
DELETE FROM fact_touchpoint a
USING fact_touchpoint b
WHERE a.source = 'smax' AND b.source = 'smax'
  AND a.dedup_key = b.dedup_key
  AND a.dedup_key IS NOT NULL
  AND (a.occurred_at < b.occurred_at
       OR (a.occurred_at = b.occurred_at AND a.id < b.id));

-- ── Step 4: unique constraint → DB-level dedup, ETL can stop pre-checking ──
-- Full (non-partial) unique index: rows with NULL dedup_key never collide.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ft_source_dedup
  ON fact_touchpoint(source, dedup_key);

-- ── Step 5: server-side snapshot view for Lark push ──────────────────
-- One row per SMAX lead: latest touchpoint + total chat count + lead metadata.
-- Lark push reads THIS instead of downloading all touchpoints to Node.
CREATE OR REPLACE VIEW v_smax_lead_snapshot AS
SELECT DISTINCT ON (t.lead_id)
  t.lead_id,
  t.event_type,
  t.title,
  t.detail,
  t.occurred_at,
  t.payload->>'customer_name' AS fallback_name,
  cnt.total_chats,
  l.full_name, l.email, l.phone, l.company, l.stage, l.assignee,
  l.smax_tags, l.external_profile_id
FROM fact_touchpoint t
JOIN (
  SELECT lead_id, COUNT(*) AS total_chats
  FROM fact_touchpoint
  WHERE source = 'smax'
  GROUP BY lead_id
) cnt USING (lead_id)
LEFT JOIN dim_lead l ON l.lead_id = t.lead_id
WHERE t.source = 'smax'
ORDER BY t.lead_id, t.occurred_at DESC;

-- ── Step 6: refresh planner stats ────────────────────────────────────
ANALYZE fact_touchpoint;
ANALYZE dim_lead;

-- ── Verify ───────────────────────────────────────────────────────────
-- SELECT COUNT(*) FROM fact_touchpoint WHERE source='smax';   -- expect ~35k, not 72k
-- SELECT COUNT(*) FROM v_smax_lead_snapshot;                  -- expect ~9.3k
-- EXPLAIN ANALYZE SELECT * FROM v_smax_lead_snapshot LIMIT 100;
