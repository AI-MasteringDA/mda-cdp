-- ============================================================
-- Backfill: Assign all existing data to ai@mastering-da.com workspace
-- ------------------------------------------------------------
-- Run AFTER multi-tenant-schema.sql AND after user ai@mastering-da.com
-- has signed up (via /signup page OR Supabase Dashboard → Auth → Add User).
-- ============================================================

DO $$
DECLARE
  mda_user_id   UUID;
  mda_account_id UUID;
  updated_count INT;
BEGIN
  -- 1. Find the auth user
  SELECT id INTO mda_user_id FROM auth.users WHERE email = 'ai@mastering-da.com' LIMIT 1;
  IF mda_user_id IS NULL THEN
    RAISE EXCEPTION 'User ai@mastering-da.com not found. Create it first via /signup or Supabase Dashboard → Auth.';
  END IF;
  RAISE NOTICE 'Found user ai@mastering-da.com: %', mda_user_id;

  -- 2. Find or create the MDA account
  SELECT id INTO mda_account_id FROM account WHERE owner_email = 'ai@mastering-da.com' LIMIT 1;
  IF mda_account_id IS NULL THEN
    INSERT INTO account (name, owner_email) VALUES ('Mastering Data Analytics', 'ai@mastering-da.com')
    RETURNING id INTO mda_account_id;
    RAISE NOTICE 'Created MDA account: %', mda_account_id;
  ELSE
    RAISE NOTICE 'Using existing MDA account: %', mda_account_id;
  END IF;

  -- 3. Ensure user is owner of MDA account
  INSERT INTO account_member (account_id, user_id, role)
  VALUES (mda_account_id, mda_user_id, 'owner')
  ON CONFLICT (account_id, user_id) DO NOTHING;

  -- 4. Backfill data tables (only rows with NULL account_id)
  UPDATE dim_lead SET account_id = mda_account_id WHERE account_id IS NULL;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'dim_lead backfilled: % rows', updated_count;

  UPDATE fact_touchpoint SET account_id = mda_account_id WHERE account_id IS NULL;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'fact_touchpoint backfilled: % rows', updated_count;

  UPDATE fact_lead_score SET account_id = mda_account_id WHERE account_id IS NULL;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'fact_lead_score backfilled: % rows', updated_count;

  UPDATE sync_job SET account_id = mda_account_id WHERE account_id IS NULL;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'sync_job backfilled: % rows', updated_count;

  UPDATE raw_salesforce_contacts SET account_id = mda_account_id WHERE account_id IS NULL;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'raw_salesforce_contacts backfilled: % rows', updated_count;

  UPDATE raw_smax_chats SET account_id = mda_account_id WHERE account_id IS NULL;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'raw_smax_chats backfilled: % rows', updated_count;

  UPDATE raw_instantly_emails SET account_id = mda_account_id WHERE account_id IS NULL;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'raw_instantly_emails backfilled: % rows', updated_count;

  RAISE NOTICE '✅ Backfill complete. MDA account_id = %', mda_account_id;
END $$;

-- Verify
SELECT 'MDA workspace summary' AS metric;
SELECT
  (SELECT COUNT(*) FROM dim_lead WHERE account_id = (SELECT id FROM account WHERE owner_email = 'ai@mastering-da.com')) AS leads,
  (SELECT COUNT(*) FROM fact_touchpoint WHERE account_id = (SELECT id FROM account WHERE owner_email = 'ai@mastering-da.com')) AS touchpoints,
  (SELECT COUNT(*) FROM fact_lead_score WHERE account_id = (SELECT id FROM account WHERE owner_email = 'ai@mastering-da.com')) AS scores;

-- Make account_id NOT NULL after backfill + set DEFAULT to MDA account_id
-- This way ETL can keep inserting without passing account_id explicitly.
-- (Phase 1: single-tenant ETL writing to MDA. Phase 2: per-tenant ETL.)
DO $$
DECLARE
  mda_id UUID;
BEGIN
  SELECT id INTO mda_id FROM account WHERE owner_email = 'ai@mastering-da.com';
  EXECUTE format('ALTER TABLE dim_lead         ALTER COLUMN account_id SET DEFAULT %L', mda_id);
  EXECUTE format('ALTER TABLE fact_touchpoint  ALTER COLUMN account_id SET DEFAULT %L', mda_id);
  EXECUTE format('ALTER TABLE fact_lead_score  ALTER COLUMN account_id SET DEFAULT %L', mda_id);
  EXECUTE format('ALTER TABLE sync_job         ALTER COLUMN account_id SET DEFAULT %L', mda_id);
  EXECUTE format('ALTER TABLE raw_salesforce_contacts ALTER COLUMN account_id SET DEFAULT %L', mda_id);
  EXECUTE format('ALTER TABLE raw_smax_chats          ALTER COLUMN account_id SET DEFAULT %L', mda_id);
  EXECUTE format('ALTER TABLE raw_instantly_emails    ALTER COLUMN account_id SET DEFAULT %L', mda_id);
END $$;

ALTER TABLE dim_lead         ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE fact_touchpoint  ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE fact_lead_score  ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE sync_job         ALTER COLUMN account_id SET NOT NULL;
