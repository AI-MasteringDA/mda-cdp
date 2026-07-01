-- ============================================================================
-- MDA CDP — CONSOLIDATED SCHEMA for fresh Supabase project (mda-cdp-v2)
-- ============================================================================
-- Paste this ENTIRE file into Supabase SQL Editor → click Run
-- Will create all tables, functions, indexes needed for the app
-- Run ONCE on a fresh DB. Idempotent (CREATE IF NOT EXISTS).
-- ============================================================================


-- ============================================================================
-- SECTION: schema.sql
-- ============================================================================
-- ============================================================
-- MDA Platform — Database Schema V1
-- ------------------------------------------------------------
-- Chạy file này trong: Supabase Dashboard → SQL Editor → New query
-- Toàn bộ schema được thiết kế cho:
--   - Cockpit (App 1) : đọc dim_lead + fact_touchpoint + fact_lead_score
--   - Growth (App 2)  : đọc fact_funnel + fact_attribution + dim_channel
--   - Ops             : đọc sync_job, ai_audit, lark_alert
-- Pattern: raw_* (data thô) → dim_* / fact_* (đã hợp nhất)
-- ============================================================

-- ------------------------------------------------------------
-- 1. PROFILES — gắn với auth.users của Supabase Auth
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'tvv' CHECK (role IN ('admin', 'manager', 'tvv', 'viewer')),
  avatar_color TEXT DEFAULT '#E0E7FF',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile khi user đăng ký
CREATE OR REPLACE FUNCTION handle_new_user() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ------------------------------------------------------------
-- 2. RAW LAYER — data thô từ ETL pull về, chưa hợp nhất
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw_salesforce_contacts (
  id TEXT PRIMARY KEY,
  email TEXT,
  phone TEXT,
  full_name TEXT,
  created_at_source TIMESTAMPTZ,
  raw_data JSONB,
  ingested_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw_smax_chats (
  id TEXT PRIMARY KEY,
  user_phone TEXT,
  message TEXT,
  direction TEXT CHECK (direction IN ('inbound', 'outbound')),
  occurred_at TIMESTAMPTZ,
  raw_data JSONB,
  ingested_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw_instantly_emails (
  id TEXT PRIMARY KEY,
  lead_email TEXT,
  subject TEXT,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  raw_data JSONB,
  ingested_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raw_sf_email ON raw_salesforce_contacts(email);
CREATE INDEX IF NOT EXISTS idx_raw_smax_phone ON raw_smax_chats(user_phone);
CREATE INDEX IF NOT EXISTS idx_raw_instantly_email ON raw_instantly_emails(lead_email);

-- ------------------------------------------------------------
-- 3. DIM LAYER — chiều (đã hợp nhất danh tính)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dim_lead (
  lead_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  phone TEXT,
  full_name TEXT,
  source TEXT,
  avatar_color TEXT DEFAULT '#E0E7FF',
  stage TEXT DEFAULT 'Mới' CHECK (stage IN ('Mới', 'Đang tư vấn', 'Đang cân nhắc', 'Im lặng', 'Ghi danh')),
  assignee_id UUID REFERENCES profiles(id),
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_touch_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_email ON dim_lead(email);
CREATE INDEX IF NOT EXISTS idx_lead_assignee ON dim_lead(assignee_id);
CREATE INDEX IF NOT EXISTS idx_lead_stage ON dim_lead(stage);

CREATE TABLE IF NOT EXISTS dim_channel (
  channel_key TEXT PRIMARY KEY,
  channel_label TEXT NOT NULL,
  channel_category TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO dim_channel (channel_key, channel_label, channel_category) VALUES
  ('google_ads', 'Google Ads', 'paid'),
  ('facebook_ads', 'Facebook Ads', 'paid'),
  ('tiktok_ads', 'TikTok Ads', 'paid'),
  ('fanpage_brand', 'Fanpage Brand', 'organic'),
  ('fanpage_phuongthao', 'Fanpage PhuongThao', 'organic'),
  ('seo', 'SEO / Organic', 'organic'),
  ('direct', 'Direct', 'direct'),
  ('referral', 'Referral', 'referral')
ON CONFLICT (channel_key) DO NOTHING;

-- ------------------------------------------------------------
-- 4. FACT LAYER — sự kiện đo lường được
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fact_touchpoint (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES dim_lead(lead_id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  title TEXT,
  detail TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_touch_lead ON fact_touchpoint(lead_id);
CREATE INDEX IF NOT EXISTS idx_touch_time ON fact_touchpoint(occurred_at DESC);

CREATE TABLE IF NOT EXISTS fact_lead_score (
  lead_id UUID REFERENCES dim_lead(lead_id) ON DELETE CASCADE,
  scored_at DATE NOT NULL,
  hot_score INT DEFAULT 0,
  cold_score INT DEFAULT 0,
  hot_reasons JSONB DEFAULT '[]'::jsonb,
  cold_reasons JSONB DEFAULT '[]'::jsonb,
  PRIMARY KEY (lead_id, scored_at)
);

CREATE INDEX IF NOT EXISTS idx_score_hot ON fact_lead_score(scored_at, hot_score DESC);
CREATE INDEX IF NOT EXISTS idx_score_cold ON fact_lead_score(scored_at, cold_score DESC);

-- ------------------------------------------------------------
-- 5. OPS LAYER — vận hành
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_job (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  records_in INT DEFAULT 0,
  records_merged INT DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_time ON sync_job(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_source ON sync_job(source, started_at DESC);

CREATE TABLE IF NOT EXISTS scoring_rule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant TEXT NOT NULL CHECK (variant IN ('hot', 'cold')),
  signal TEXT NOT NULL,
  signal_label TEXT NOT NULL,
  operator TEXT NOT NULL CHECK (operator IN ('>', '>=', '<', '<=', '=')),
  threshold NUMERIC NOT NULL,
  weight INT NOT NULL,
  time_window TEXT NOT NULL DEFAULT '7d',
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_name TEXT NOT NULL,
  lead_id UUID REFERENCES dim_lead(lead_id),
  approver_id UUID REFERENCES profiles(id),
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'sent', 'rejected')),
  preview TEXT
);

CREATE TABLE IF NOT EXISTS lark_alert (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name TEXT NOT NULL,
  lead_id UUID REFERENCES dim_lead(lead_id),
  reason TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  delivered BOOLEAN DEFAULT false
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE dim_lead ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_touchpoint ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_lead_score ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE lark_alert ENABLE ROW LEVEL SECURITY;

-- Policy V1: ai login đều xem được tất cả (đơn giản hóa cho V1)
-- V2 sẽ refactor: TVV chỉ thấy lead của mình
CREATE POLICY "authenticated read all" ON profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read all" ON dim_lead
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read all" ON fact_touchpoint
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read all" ON fact_lead_score
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read all" ON sync_job
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read all" ON scoring_rule
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read all" ON ai_audit
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read all" ON lark_alert
  FOR SELECT TO authenticated USING (true);


-- ============================================================================
-- SECTION: multi-tenant-schema.sql
-- ============================================================================
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
ALTER TABLE dim_lead DROP CONSTRAINT IF EXISTS dim_lead_account_email_unique;
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


-- ============================================================================
-- SECTION: add-lead-metadata.sql
-- ============================================================================
-- ============================================================
-- Add Lead Metadata Columns + Backfill "Lead Created" Touchpoint
-- ------------------------------------------------------------
-- Mục đích: timeline mọi lead có ít nhất 1 event (creation),
-- profile hiển thị company + TVV phụ trách + nguồn detail.
-- ============================================================

-- 1. Add columns
ALTER TABLE dim_lead
  ADD COLUMN IF NOT EXISTS company TEXT,
  ADD COLUMN IF NOT EXISTS assignee TEXT,
  ADD COLUMN IF NOT EXISTS lead_source TEXT;

COMMENT ON COLUMN dim_lead.company IS 'Company từ Salesforce Account.Name hoặc Lead.Company';
COMMENT ON COLUMN dim_lead.assignee IS 'TVV phụ trách (Owner.Name từ Salesforce)';
COMMENT ON COLUMN dim_lead.lead_source IS 'Kênh chi tiết (Lead.LeadSource, campaign...) - khác với cột source là loại nguồn';

-- 2. Backfill "Lead Created" touchpoint cho lead chưa có
INSERT INTO fact_touchpoint (lead_id, source, event_type, title, detail, occurred_at, payload)
SELECT
  l.lead_id,
  l.source,
  'lead_created',
  CASE l.source
    WHEN 'salesforce' THEN '🚪 Tạo lead trong Salesforce'
    WHEN 'instantly'  THEN '🚪 Vào hệ thống qua Instantly email'
    WHEN 'smax'       THEN '🚪 Vào hệ thống qua SMAX chat'
    WHEN 'fanpage'    THEN '🚪 Tạo lead từ Fanpage'
    WHEN 'web'        THEN '🚪 Tạo lead từ Website'
    ELSE              '🚪 Tạo lead'
  END,
  NULL,
  COALESCE(l.first_seen_at, NOW()),
  jsonb_build_object('source', l.source, 'backfilled', true)
FROM dim_lead l
LEFT JOIN fact_touchpoint t
  ON t.lead_id = l.lead_id AND t.event_type = 'lead_created'
WHERE t.id IS NULL;

-- 3. Show kết quả backfill
SELECT
  COUNT(*) FILTER (WHERE event_type = 'lead_created') AS lead_created_count,
  COUNT(DISTINCT lead_id) FILTER (WHERE event_type = 'lead_created') AS unique_leads_with_created
FROM fact_touchpoint;


-- ============================================================================
-- SECTION: add-etl-state-table.sql
-- ============================================================================
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


-- ============================================================================
-- SECTION: add-lead-aggregates.sql
-- ============================================================================
-- ============================================================
-- Lead Aggregates: pre-computed metrics per lead for fast queries
-- ------------------------------------------------------------
-- Vấn đề: mỗi lần load lead detail → JOIN fact_touchpoint → đếm
-- email/chat/conversion → chậm khi DB lớn. Mỗi lần tính scoring
-- cũng phải re-scan touchpoints.
--
-- Giải pháp: cache aggregates trên dim_lead. Update khi:
--   1. ETL insert touchpoints mới (trigger)
--   2. SCORING recompute (manual call)
-- ============================================================

ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS total_touchpoints INT DEFAULT 0;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS email_received_count INT DEFAULT 0;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS email_open_count INT DEFAULT 0;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS email_click_count INT DEFAULT 0;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS chat_count INT DEFAULT 0;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS chat_staff_count INT DEFAULT 0;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS conversion_count INT DEFAULT 0;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS web_page_view_count INT DEFAULT 0;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS last_email_at TIMESTAMPTZ;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS last_chat_at TIMESTAMPTZ;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS last_chat_staff_at TIMESTAMPTZ;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS last_engagement_at TIMESTAMPTZ;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS source_count INT DEFAULT 0;

-- Backfill function: compute aggregates from fact_touchpoint
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
      COUNT(*) FILTER (WHERE event_type = 'chat')        AS chat_count,
      COUNT(*) FILTER (WHERE event_type = 'chat_staff')  AS chat_staff_count,
      COUNT(*) FILTER (WHERE event_type = 'conversion')  AS conversion_count,
      COUNT(*) FILTER (WHERE event_type = 'page_view')   AS web_page_view_count,
      MAX(occurred_at) FILTER (WHERE event_type IN ('email_sent','email_open','email_click','email_reply')) AS last_email_at,
      MAX(occurred_at) FILTER (WHERE event_type = 'chat')                AS last_chat_at,
      MAX(occurred_at) FILTER (WHERE event_type = 'chat_staff')          AS last_chat_staff_at,
      MAX(occurred_at) FILTER (
        WHERE event_type IN ('chat','chat_staff','email_open','email_click','email_reply','call','meeting','form_submit','page_view','conversion')
      ) AS last_engagement_at,
      COUNT(DISTINCT source) FILTER (
        WHERE source IN ('smax','salesforce','instantly','web','fanpage')
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

GRANT EXECUTE ON FUNCTION recompute_lead_aggregates() TO anon, authenticated;

-- Run initial backfill
SELECT 'Running initial backfill...' AS step;
SELECT recompute_lead_aggregates() AS leads_updated;

-- Verify: sample 5 leads with multi-source / engagement
SELECT 'Sample top engagement leads' AS step;
SELECT full_name, total_touchpoints, email_received_count, chat_count, chat_staff_count, conversion_count, source_count
FROM dim_lead
WHERE conversion_count > 0 OR chat_count > 0
ORDER BY total_touchpoints DESC
LIMIT 5;

SELECT '✅ Aggregate columns added + backfilled.' AS status;


-- ============================================================================
-- SECTION: add-increment-counter-fn.sql
-- ============================================================================
-- ============================================================
-- Helper RPC: increment a counter field on dim_lead + update timestamps
-- Used by webhook endpoints to update aggregates in-place without
-- triggering full recompute_lead_aggregates() scan.
-- ============================================================

CREATE OR REPLACE FUNCTION increment_lead_counter(
  target_lead_id UUID,
  counter_field TEXT,
  occurred_at_value TIMESTAMPTZ
) RETURNS VOID AS $$
BEGIN
  -- Allowlist of counter fields (prevent SQL injection)
  IF counter_field NOT IN (
    'email_received_count', 'email_open_count', 'email_click_count',
    'chat_count', 'chat_staff_count', 'conversion_count', 'web_page_view_count',
    'total_touchpoints'
  ) THEN
    RAISE EXCEPTION 'Invalid counter_field: %', counter_field;
  END IF;

  EXECUTE format(
    'UPDATE dim_lead
     SET %I = COALESCE(%I, 0) + 1,
         last_engagement_at = GREATEST(COALESCE(last_engagement_at, %L), %L),
         last_email_at = CASE WHEN %L IN (''email_open_count'', ''email_click_count'', ''email_received_count'')
                              THEN GREATEST(COALESCE(last_email_at, %L), %L)
                              ELSE last_email_at END
     WHERE lead_id = %L',
    counter_field, counter_field,
    occurred_at_value, occurred_at_value,
    counter_field,
    occurred_at_value, occurred_at_value,
    target_lead_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION increment_lead_counter(UUID, TEXT, TIMESTAMPTZ) TO anon, authenticated, service_role;

SELECT '✅ increment_lead_counter RPC created.' AS status;


-- ============================================================================
-- SECTION: add-workspace-secrets.sql
-- ============================================================================
-- ============================================================
-- workspace_secret — workspace-shared secret storage
-- ------------------------------------------------------------
-- Cho phép user paste API key (Anthropic, etc.) vào UI và lưu chung
-- cho cả workspace, không cần mỗi máy/user setup riêng.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.workspace_secret (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  /** Key name — vd: "anthropic_api_key" */
  key_name text NOT NULL,
  /** Plaintext value — store within workspace boundary; service-role only access */
  value text NOT NULL,
  /** Last 4 chars for safe display in UI (vd: "...xkj7") */
  display_hint text,
  metadata jsonb DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_email text,
  UNIQUE (key_name)
);

CREATE INDEX IF NOT EXISTS workspace_secret_key_idx ON public.workspace_secret(key_name);

-- Service role bypasses RLS; only API endpoints (server-side) read raw values.
-- Authenticated users can SELECT to know if key is set (presence check) but
-- cannot read raw `value` — we only return display_hint to UI.
ALTER TABLE public.workspace_secret ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_secret_no_client_read ON public.workspace_secret;
CREATE POLICY workspace_secret_no_client_read
  ON public.workspace_secret FOR SELECT TO authenticated
  USING (false);  -- block client direct read; force going through API

-- Service role has full access (default RLS bypass)
GRANT ALL ON public.workspace_secret TO service_role;
GRANT ALL ON public.workspace_secret TO postgres;

NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- SECTION: add-ai-cache.sql
-- ============================================================================
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


-- ============================================================================
-- SECTION: reclassify-smax-and-scoring-v7.sql
-- ============================================================================
-- ============================================================
-- V7: Fix scoring inflation + reclassify existing SMAX threads
-- ------------------------------------------------------------
-- Vấn đề tìm thấy:
-- 1. SMAX ETL phân loại sai sender: TVV nói nhưng label 'chat'
-- 2. Scoring V6 dùng total_touchpoints (bao gồm lead_created)
--    → duplicate lead_created từ SF inflate điểm
-- 3. Lead có 6 lead_created + 1 TVV msg vẫn score 100/100
--
-- V7 fix:
-- A. Reclassify existing SMAX threads: nếu last_msg > last_customer_msg
--    hoặc không có last_customer_msg → event_type='chat_staff'
-- B. Scoring dùng aggregate có ý nghĩa thật (chat_count, email_open_count...)
--    KHÔNG dùng total_touchpoints
-- C. "Tổng tương tác" = real engagement events
-- D. "Đa kênh" yêu cầu >= 1 engagement (không phải chỉ lead_created) ở mỗi nguồn
-- ============================================================

-- A. RECLASSIFY existing SMAX threads (one-time backfill)
-- Use payload to determine sender. If sender_is_staff exists → use that.
-- Otherwise heuristic: compare last_msg_at vs last_customer_msg_at in payload.

UPDATE fact_touchpoint
SET event_type = 'chat_staff',
    title = REPLACE(title, 'Chat: ', 'TVV chat: ')
WHERE source = 'smax'
  AND event_type = 'chat'
  AND (
    -- Has sender_is_staff field marked true
    (payload->>'sender_is_staff')::boolean = true
    OR
    -- Heuristic: last_msg later than last_customer_msg
    (payload->>'last_msg_at' IS NOT NULL
     AND payload->>'last_customer_msg_at' IS NOT NULL
     AND (payload->>'last_msg_at')::timestamptz > (payload->>'last_customer_msg_at')::timestamptz)
    OR
    -- No customer message recorded but has message → broadcast from TVV
    (payload->>'last_msg_at' IS NOT NULL AND payload->>'last_customer_msg_at' IS NULL)
  );

SELECT 'Reclassified SMAX threads — old chat counts' AS step;
SELECT event_type, COUNT(*) FROM fact_touchpoint
WHERE source = 'smax'
GROUP BY event_type;

-- B. Update recompute_lead_aggregates to also compute engagement_total
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS engagement_count INT DEFAULT 0;

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
      COUNT(*) FILTER (WHERE event_type = 'chat')        AS chat_count,
      COUNT(*) FILTER (WHERE event_type = 'chat_staff')  AS chat_staff_count,
      COUNT(*) FILTER (WHERE event_type = 'conversion')  AS conversion_count,
      COUNT(*) FILTER (WHERE event_type = 'page_view')   AS web_page_view_count,
      -- NEW: meaningful engagement count (excludes lead_created)
      COUNT(*) FILTER (
        WHERE event_type IN ('chat','chat_staff','email_open','email_click','email_reply','call','meeting','form_submit','page_view','conversion')
      ) AS engagement_count,
      MAX(occurred_at) FILTER (WHERE event_type IN ('email_sent','email_open','email_click','email_reply')) AS last_email_at,
      MAX(occurred_at) FILTER (WHERE event_type = 'chat')                AS last_chat_at,
      MAX(occurred_at) FILTER (WHERE event_type = 'chat_staff')          AS last_chat_staff_at,
      MAX(occurred_at) FILTER (
        WHERE event_type IN ('chat','chat_staff','email_open','email_click','email_reply','call','meeting','form_submit','page_view','conversion')
      ) AS last_engagement_at,
      -- source_count: only sources where lead has REAL engagement (not just lead_created)
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

-- C. Scoring V7: use REAL engagement signals
DROP FUNCTION IF EXISTS recompute_lead_scores();

CREATE FUNCTION recompute_lead_scores()
RETURNS TABLE (out_lead_id UUID, out_score INT, out_tier TEXT) AS $$
BEGIN
  RETURN QUERY
  WITH
  signals AS (
    SELECT
      l.lead_id AS lid,
      -- Recency flags
      (l.last_chat_at > NOW() - INTERVAL '3 days') AS chat_recent,
      (l.last_chat_staff_at > NOW() - INTERVAL '3 days') AS reply_recent,
      (l.last_email_at > NOW() - INTERVAL '7 days') AS email_recent,
      l.chat_staff_count AS staff_total,
      l.chat_count AS chat_total,
      l.engagement_count AS engagement_total,  -- NEW: excludes lead_created
      l.source_count AS source_count,          -- NEW: only counts engaged sources
      l.conversion_count AS conversions,
      l.email_open_count AS opens,
      l.email_received_count AS emails_sent,

      COALESCE(
        EXTRACT(EPOCH FROM (NOW() - l.last_engagement_at)) / 86400,
        9999
      ) AS silent_days,

      (l.chat_count + l.chat_staff_count + l.email_open_count + l.email_click_count + l.conversion_count) > 0 AS has_engagement
    FROM dim_lead l
    WHERE l.stage != 'Đã chốt'
  ),
  computed AS (
    SELECT
      s.lid,
      s.chat_recent, s.reply_recent, s.email_recent,
      s.staff_total, s.chat_total, s.engagement_total, s.source_count,
      s.conversions, s.opens, s.emails_sent, s.silent_days, s.has_engagement,
      40 +
      -- Real lead chat (not TVV broadcast)
      (CASE WHEN s.chat_recent AND s.chat_total > 0 THEN 35 ELSE 0 END) +
      (CASE WHEN s.reply_recent THEN 20 ELSE 0 END) +
      (CASE WHEN s.email_recent THEN 5 ELSE 0 END) +
      (CASE WHEN s.staff_total >= 5 THEN 15 ELSE 0 END) +
      (CASE WHEN s.engagement_total >= 5 THEN 10 ELSE 0 END) +  -- engagement, not total_touchpoints
      (CASE WHEN s.source_count >= 2 THEN 20 ELSE 0 END) +       -- engaged sources only
      (CASE WHEN s.conversions > 0 THEN 25 ELSE 0 END) +
      (CASE
        WHEN s.emails_sent >= 5 AND s.opens::FLOAT / NULLIF(s.emails_sent, 0) > 0.3 THEN 15
        WHEN s.emails_sent >= 10 AND s.opens = 0 THEN -10
        ELSE 0
      END) +
      (CASE
        WHEN s.silent_days <= 30 THEN 0
        WHEN s.silent_days <= 90 THEN -20
        WHEN s.silent_days <= 180 THEN -40
        ELSE -60
      END) +
      (CASE WHEN NOT s.has_engagement THEN -10 ELSE 0 END)
      AS raw_score
    FROM signals s
  ),
  clamped AS (
    SELECT
      c.lid,
      GREATEST(0, LEAST(100, c.raw_score))::INT AS score,
      (
        SELECT jsonb_agg(reason ORDER BY (reason->>'points')::int DESC)
        FROM (
          SELECT jsonb_build_object('sign', '+', 'label', 'Lead chat trong 3 ngày qua', 'points', 35) AS reason
            WHERE c.chat_recent AND c.chat_total > 0
          UNION ALL SELECT jsonb_build_object('sign', '+', 'label', 'TVV reply trong 3 ngày', 'points', 20) WHERE c.reply_recent
          UNION ALL SELECT jsonb_build_object('sign', '+', 'label', 'MDA gửi email trong 7 ngày', 'points', 5) WHERE c.email_recent
          UNION ALL SELECT jsonb_build_object('sign', '+', 'label', 'TVV chat tổng >= 5 lần', 'points', 15) WHERE c.staff_total >= 5
          UNION ALL SELECT jsonb_build_object('sign', '+', 'label', 'Tổng engagement >= 5 (real)', 'points', 10) WHERE c.engagement_total >= 5
          UNION ALL SELECT jsonb_build_object('sign', '+', 'label', 'Đa kênh engaged (>= 2 nguồn thật)', 'points', 20) WHERE c.source_count >= 2
          UNION ALL SELECT jsonb_build_object('sign', '+', 'label', 'Đã từng mua khóa khác', 'points', 25) WHERE c.conversions > 0
          UNION ALL SELECT jsonb_build_object('sign', '+', 'label', 'Mở email > 30% (engaged)', 'points', 15)
            WHERE c.emails_sent >= 5 AND c.opens::FLOAT / NULLIF(c.emails_sent, 0) > 0.3
          UNION ALL SELECT jsonb_build_object('sign', '-', 'label', 'Nhận nhiều email nhưng không mở', 'points', 10)
            WHERE c.emails_sent >= 10 AND c.opens = 0
          UNION ALL SELECT jsonb_build_object('sign', '-', 'label', 'Im lặng 30-90 ngày', 'points', 20) WHERE c.silent_days > 30 AND c.silent_days <= 90
          UNION ALL SELECT jsonb_build_object('sign', '-', 'label', 'Im lặng 90-180 ngày', 'points', 40) WHERE c.silent_days > 90 AND c.silent_days <= 180
          UNION ALL SELECT jsonb_build_object('sign', '-', 'label', 'Im lặng > 180 ngày', 'points', 60) WHERE c.silent_days > 180
          UNION ALL SELECT jsonb_build_object('sign', '-', 'label', 'Chưa từng tương tác thật sự', 'points', 10) WHERE NOT c.has_engagement
        ) reasons_subq
      ) AS reasons_json
    FROM computed c
  ),
  upserted AS (
    INSERT INTO fact_lead_score (lead_id, scored_at, hot_score, cold_score, hot_reasons, cold_reasons)
    SELECT
      cl.lid, CURRENT_DATE, cl.score, GREATEST(0, 100 - cl.score),
      COALESCE(cl.reasons_json, '[]'::jsonb), '[]'::jsonb
    FROM clamped cl
    ON CONFLICT (lead_id, scored_at) DO UPDATE SET
      hot_score = EXCLUDED.hot_score,
      cold_score = EXCLUDED.cold_score,
      hot_reasons = EXCLUDED.hot_reasons,
      cold_reasons = EXCLUDED.cold_reasons
    RETURNING fact_lead_score.lead_id, fact_lead_score.hot_score
  )
  SELECT u.lead_id, u.hot_score, lead_tier(u.hot_score) FROM upserted u;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION recompute_lead_aggregates() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION recompute_lead_scores() TO anon, authenticated;

-- Run both
SELECT 'Recomputing aggregates...' AS step;
SELECT recompute_lead_aggregates() AS aggregates_updated;

SELECT 'Recomputing scores V7...' AS step;
SELECT COUNT(*) AS total_scored FROM recompute_lead_scores();

-- Show new distribution
SELECT 'Tier distribution after V7' AS metric;
SELECT lead_tier(hot_score) AS tier, COUNT(*) AS count, MIN(hot_score) AS min, MAX(hot_score) AS max
FROM fact_lead_score WHERE scored_at = CURRENT_DATE
GROUP BY tier ORDER BY min DESC;


-- ============================================================================
-- SECTION: fix-empty-chat-classification.sql
-- ============================================================================
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


-- ============================================================================
-- SECTION: sf-unique-constraints.sql
-- ============================================================================
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

