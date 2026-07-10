-- ═══════════════════════════════════════════════════════════════════
-- SMAX Audit — schema for chat history + AI findings
-- Deploy AFTER Supabase incident resolves and CDP is stable
-- ═══════════════════════════════════════════════════════════════════

-- 1. Chat message history (raw messages from SMAX, 1 row per message)
CREATE TABLE IF NOT EXISTS fact_smax_message (
  message_id      TEXT        PRIMARY KEY,           -- SMAX's own message id
  thread_id       TEXT        NOT NULL,
  lead_id         UUID        NOT NULL REFERENCES dim_lead(lead_id) ON DELETE CASCADE,
  page_pid        TEXT,
  platform        TEXT,                              -- 'facebook' / 'zaloweb' / 'zl' / 'ig' / 'custom'
  sender_pid      TEXT,
  sender_is_staff BOOLEAN     NOT NULL DEFAULT FALSE,
  content         TEXT,                              -- message body
  has_attachments BOOLEAN     NOT NULL DEFAULT FALSE,
  occurred_at     TIMESTAMPTZ NOT NULL,
  inserted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Efficient AI query: "give me last N messages of this lead"
CREATE INDEX IF NOT EXISTS idx_fsm_lead_ts    ON fact_smax_message(lead_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_fsm_thread     ON fact_smax_message(thread_id);
CREATE INDEX IF NOT EXISTS idx_fsm_ts         ON fact_smax_message(occurred_at DESC);


-- 2. Audit findings (AI output — 1 row per (lead, audit_type, check))
CREATE TABLE IF NOT EXISTS fact_audit_finding (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID        NOT NULL REFERENCES dim_lead(lead_id) ON DELETE CASCADE,
  audit_type      TEXT        NOT NULL,              -- 'missing_tags' (MVP) / 'info_not_requested' / 'needs_followup'
  is_ok           BOOLEAN     NOT NULL,              -- true = passed, false = issue found
  missing_items   TEXT[],                            -- e.g. ['Hot Lead', 'K61']
  ai_reason       JSONB,                             -- evidence + quotes from chat
  ai_note         TEXT,                              -- 1-2 câu tóm tắt hiển thị trên Lark
  chat_hash       TEXT,                              -- hash content audit → skip re-audit if same
  ai_model        TEXT,                              -- 'claude-haiku-4-5' etc.
  ai_tokens_in    INT,
  ai_tokens_out   INT,
  checked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Get latest finding per lead × type — used by Lark push
CREATE INDEX IF NOT EXISTS idx_af_lead_type_ts ON fact_audit_finding(lead_id, audit_type, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_af_open_issues  ON fact_audit_finding(audit_type, is_ok, checked_at DESC)
  WHERE is_ok = FALSE;

-- ═══════════════════════════════════════════════════════════════════
-- Notes:
-- - fact_smax_message intentionally separate from fact_touchpoint. Keeps
--   CDP snapshot table small. Audit worker only touches these 2 tables.
-- - We DON'T update tags on dim_lead from audit — leave that to Giàu (human).
--   Audit just NOTIFIES what's missing.
-- - chat_hash lets us skip re-audit when chat hasn't changed since last check
--   → keeps AI cost low.
-- ═══════════════════════════════════════════════════════════════════
