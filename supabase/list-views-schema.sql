-- ============================================================================
-- SF List View mirror — auto-sync Sales' saved filters into CDP
-- ============================================================================
-- Sales team creates list views on Salesforce (e.g. "Khóa BI đang mở").
-- ETL pulls views + members every hour → CDP shows same lists as filter chips.
-- Nothing to configure in CDP: whatever Sales creates on SF appears on CDP.
-- ============================================================================

-- 1. List view metadata (name, developer_name, sf object type)
CREATE TABLE IF NOT EXISTS dim_list_view (
  view_id         TEXT PRIMARY KEY,
  view_name       TEXT NOT NULL,
  developer_name  TEXT,
  sf_object_type  TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dim_list_view_name ON dim_list_view(view_name);
CREATE INDEX IF NOT EXISTS idx_dim_list_view_sf_object ON dim_list_view(sf_object_type);

-- 2. Membership: which leads belong to which list view
CREATE TABLE IF NOT EXISTS fact_list_view_member (
  view_id   TEXT REFERENCES dim_list_view(view_id) ON DELETE CASCADE,
  lead_id   UUID REFERENCES dim_lead(lead_id) ON DELETE CASCADE,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (view_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_flv_lead ON fact_list_view_member(lead_id);
CREATE INDEX IF NOT EXISTS idx_flv_view ON fact_list_view_member(view_id);

-- 3. Enable RLS but allow full access (multi-tenant not enforced on these yet)
ALTER TABLE dim_list_view ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_list_view_member ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow all on dim_list_view" ON dim_list_view;
CREATE POLICY "allow all on dim_list_view" ON dim_list_view FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow all on fact_list_view_member" ON fact_list_view_member;
CREATE POLICY "allow all on fact_list_view_member" ON fact_list_view_member FOR ALL USING (true) WITH CHECK (true);
