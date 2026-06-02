-- ============================================================
-- ETL state table: persist cursors for resumable pulls
-- ------------------------------------------------------------
-- Mỗi source × key có 1 row chứa giá trị state (e.g. cursor pagination).
-- Khi Instantly trả về 500 giữa chừng, ETL save cursor → lần chạy sau resume.
-- ============================================================

CREATE TABLE IF NOT EXISTS etl_state (
  source TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (source, key)
);

-- ETL uses service_role key → bypasses RLS automatically. No policy needed.
-- But enable RLS as a safety net.
ALTER TABLE etl_state ENABLE ROW LEVEL SECURITY;

-- Only service_role can access (no user-facing policy)
DROP POLICY IF EXISTS "service_only" ON etl_state;
-- Intentionally no SELECT policy → authenticated users can't see ETL state

SELECT 'etl_state table created.' AS status;
