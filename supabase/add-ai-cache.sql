-- ============================================================
-- AI Cache table — store generated insights/plans to avoid re-generating
-- ------------------------------------------------------------
-- Purpose: User-driven refresh model. AI results persist forever
-- until user explicitly clicks "Refresh". Saves tokens + cost.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,  -- {model, elapsed_seconds, generated_by_user_id, ...}
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_cache_key_idx ON ai_cache(cache_key);
CREATE INDEX IF NOT EXISTS ai_cache_updated_idx ON ai_cache(updated_at DESC);

-- Grant access for authenticated users (RLS not needed — cache is workspace-shared)
ALTER TABLE ai_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_cache_read ON ai_cache;
CREATE POLICY ai_cache_read ON ai_cache FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS ai_cache_write ON ai_cache;
CREATE POLICY ai_cache_write ON ai_cache FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Service role bypass (for backend API)
GRANT ALL ON ai_cache TO service_role;
GRANT SELECT ON ai_cache TO authenticated;
