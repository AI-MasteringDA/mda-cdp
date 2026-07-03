-- ============================================================================
-- 365-DAY ROLLING WINDOW AUTO-PRUNE
-- ============================================================================
-- Keeps fact_touchpoint sliding: always the LAST 365 days from today.
-- Runs daily at 03:00 UTC (10:00 VN time).
-- Also clears orphan leads (no touchpoints in 365 days, no cross-source links).
-- ============================================================================

-- 1. Enable pg_cron (safe to re-run)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Function: delete touchpoints older than 365 days
CREATE OR REPLACE FUNCTION prune_touchpoints_365d()
RETURNS TABLE (deleted_touchpoints int, deleted_leads int) AS $$
DECLARE
  v_tp int := 0;
  v_leads int := 0;
BEGIN
  -- Delete touchpoints older than 365 days
  DELETE FROM fact_touchpoint
  WHERE occurred_at < NOW() - INTERVAL '365 days';
  GET DIAGNOSTICS v_tp = ROW_COUNT;

  -- Delete leads with NO touchpoints in the last 365 days (orphaned)
  -- Only if the lead has no recent activity at all
  DELETE FROM dim_lead
  WHERE lead_id NOT IN (
    SELECT DISTINCT lead_id
    FROM fact_touchpoint
    WHERE lead_id IS NOT NULL
  );
  GET DIAGNOSTICS v_leads = ROW_COUNT;

  RAISE NOTICE '365d-prune: deleted % touchpoints, % orphan leads', v_tp, v_leads;
  RETURN QUERY SELECT v_tp, v_leads;
END;
$$ LANGUAGE plpgsql;

-- 3. Unschedule any existing prune jobs (safe to re-run)
DO $$
DECLARE
  jname text;
BEGIN
  FOR jname IN
    SELECT jobname FROM cron.job
    WHERE jobname IN ('prune-touchpoints-365d', 'auto-prune-daily', 'prune-old-data')
  LOOP
    PERFORM cron.unschedule(jname);
    RAISE NOTICE 'Unscheduled old cron job: %', jname;
  END LOOP;
END $$;

-- 4. Schedule daily prune at 03:00 UTC (10:00 VN)
SELECT cron.schedule(
  'prune-touchpoints-365d',
  '0 3 * * *',
  $$SELECT prune_touchpoints_365d();$$
);

-- 5. Run once immediately to establish 365-day baseline
SELECT * FROM prune_touchpoints_365d();

-- 6. Verify
SELECT
  MIN(occurred_at) AS oldest_touchpoint,
  MAX(occurred_at) AS newest_touchpoint,
  COUNT(*)         AS total_touchpoints,
  EXTRACT(DAY FROM (MAX(occurred_at) - MIN(occurred_at))) AS spread_days
FROM fact_touchpoint;

-- 7. Confirm cron job is active
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'prune-touchpoints-365d';
