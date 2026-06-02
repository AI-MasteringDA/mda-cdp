-- ============================================================
-- Multi-tenant SaaS migration
-- ------------------------------------------------------------
-- - account: workspace (1 row per company)
-- - account_member: junction user <-> account with role
-- - Add account_id to all data tables (dim_lead, fact_*, etc.)
-- - RLS: user only sees data of accounts they belong to
-- ============================================================

-- 1. ACCOUNT TABLE
CREATE TABLE IF NOT EXISTS account (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_account_owner_email ON account(owner_email);

-- 2. ACCOUNT_MEMBER (user ↔ account, with role)
CREATE TABLE IF NOT EXISTS account_member (
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'manager', 'tvv', 'viewer')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (account_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_account_member_user ON account_member(user_id);

-- 3. Add account_id to all data tables (nullable initially for backfill)
ALTER TABLE dim_lead         ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES account(id) ON DELETE CASCADE;
ALTER TABLE fact_touchpoint  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES account(id) ON DELETE CASCADE;
ALTER TABLE fact_lead_score  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES account(id) ON DELETE CASCADE;
ALTER TABLE sync_job         ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES account(id) ON DELETE CASCADE;

-- Raw tables (data thô)
ALTER TABLE raw_salesforce_contacts ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES account(id) ON DELETE CASCADE;
ALTER TABLE raw_smax_chats          ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES account(id) ON DELETE CASCADE;
ALTER TABLE raw_instantly_emails    ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES account(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_dim_lead_account        ON dim_lead(account_id);
CREATE INDEX IF NOT EXISTS idx_fact_touchpoint_account ON fact_touchpoint(account_id);
CREATE INDEX IF NOT EXISTS idx_fact_lead_score_account ON fact_lead_score(account_id);
CREATE INDEX IF NOT EXISTS idx_sync_job_account        ON sync_job(account_id);

-- dim_lead.email unique → cần thay đổi: unique per (account_id, email)
-- Drop existing global unique constraint, add composite unique
ALTER TABLE dim_lead DROP CONSTRAINT IF EXISTS dim_lead_email_key;
ALTER TABLE dim_lead ADD CONSTRAINT dim_lead_account_email_unique UNIQUE (account_id, email);

-- 4. RLS HELPER: check if current user belongs to an account
CREATE OR REPLACE FUNCTION user_in_account(target_account_id UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM account_member
    WHERE user_id = auth.uid() AND account_id = target_account_id
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION user_in_account(UUID) TO anon, authenticated;

-- 5. Trigger: on auth.users INSERT → auto-create account + membership
CREATE OR REPLACE FUNCTION handle_new_user_account() RETURNS TRIGGER AS $$
DECLARE
  new_account_id UUID;
BEGIN
  -- Skip if user already has account (e.g. invited)
  IF EXISTS (SELECT 1 FROM account_member WHERE user_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Create workspace named after their email's domain
  INSERT INTO account (name, owner_email)
  VALUES (
    COALESCE(NEW.raw_user_meta_data->>'workspace_name', 'Workspace của ' || NEW.email),
    NEW.email
  )
  RETURNING id INTO new_account_id;

  -- Add as owner
  INSERT INTO account_member (account_id, user_id, role)
  VALUES (new_account_id, NEW.id, 'owner');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_account ON auth.users;
CREATE TRIGGER on_auth_user_created_account
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user_account();

-- 6. RLS policies (production-grade — replaces dev open policy)
-- Enable RLS first if not already
ALTER TABLE account             ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_member      ENABLE ROW LEVEL SECURITY;
ALTER TABLE dim_lead            ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_touchpoint     ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_lead_score     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_job            ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_salesforce_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_smax_chats          ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_instantly_emails    ENABLE ROW LEVEL SECURITY;

-- Drop old dev policies
DROP POLICY IF EXISTS "dev_open_all" ON dim_lead;
DROP POLICY IF EXISTS "dev_open_all" ON fact_touchpoint;
DROP POLICY IF EXISTS "dev_open_all" ON fact_lead_score;
DROP POLICY IF EXISTS "dev_open_all" ON sync_job;

-- account: user can see their own accounts
DROP POLICY IF EXISTS "account_member_select" ON account;
CREATE POLICY "account_member_select" ON account FOR SELECT
  USING (user_in_account(id));

-- account_member: user can see members of their accounts
DROP POLICY IF EXISTS "account_member_self_select" ON account_member;
CREATE POLICY "account_member_self_select" ON account_member FOR SELECT
  USING (user_id = auth.uid() OR user_in_account(account_id));

-- Data tables: SELECT + INSERT + UPDATE if user belongs to account_id
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'dim_lead', 'fact_touchpoint', 'fact_lead_score', 'sync_job',
    'raw_salesforce_contacts', 'raw_smax_chats', 'raw_instantly_emails'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "tenant_isolation" ON %I', tbl);
    EXECUTE format('CREATE POLICY "tenant_isolation" ON %I
      FOR ALL USING (user_in_account(account_id))
      WITH CHECK (user_in_account(account_id))', tbl);
  END LOOP;
END $$;

-- 7. Service role bypass (ETL uses service_role key which bypasses RLS)
-- No additional config needed - service_role has BYPASSRLS by default

SELECT 'Multi-tenant schema migration done.' AS status;
SELECT 'Next: run backfill-mda-account.sql to assign existing data to ai@mastering-da.com' AS next_step;
