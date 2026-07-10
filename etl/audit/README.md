# SMAX Audit — Design Doc

> Status: **draft (offline design, no infra deployed yet)**
> Owner: AI-MasteringDA
> Blocks on: Supabase incident + CDP optimization

## Purpose
Detect when a SMAX lead needs action but hasn't gotten it:
- **Case B** (MVP): tag đã cần gắn nhưng TVV chưa gắn
- Case A (Phase 2): cold lead chưa được xin info
- Case C (Phase 3): warm/cold lead cần follow-up

## Architecture

```
[SMAX API]
    │
    │ pullSmaxMessages() — hourly cron
    ▼
[Supabase]
  fact_smax_message          ← 1 row per message, indexed by (lead_id, ts DESC)
    │
    │ audit worker — hourly cron
    │   1. for each lead with new messages since last audit:
    │        - load last 30 messages
    │        - load current smax_tags from dim_lead
    │        - call Claude Haiku with our prompt
    │        - insert into fact_audit_finding
    ▼
  fact_audit_finding         ← 1 row per (lead, audit_type, check)
    │
    │ existing lark-push extension
    ▼
[Lark Base SMAX_Database — add 2 columns]
  ✅ "Đủ tag"     (checkbox from latest finding.is_ok)
  📝 "Tag thiếu"  (text from latest finding.missing_items)
```

## Why NOT everything in Lark
- Lark text cell max ~10k chars — 1 lead có 50+ messages tổng > 10k chars → không nhét full history
- Lark isn't a queryable DB → AI must fetch via API → slow
- Can't track audit history (only latest value in cell)
- Coloring/filtering on Sales view limited if all data in 1 cell

## Prompt design principles
1. **Whitelist tags** — LLM chỉ suggest từ `ALLOWED_SMAX_TAGS` list. Reject hallucinated tags at validation time.
2. **Evidence required** — every suggestion must quote the chat.
3. **Bias toward false negatives** — "sai còn tệ hơn bỏ sót" (per user).
4. **JSON only output** — no markdown/prose to parse.

## Cost estimate
- Claude Haiku 4.5 pricing: $0.80/M input, $4/M output
- Per audit: ~3000 input + ~200 output = ~$0.003
- 100–500 audits/day (only leads with new messages) = **$10–15/month**

## Deployment order (do NOT deploy before these done)
1. Supabase incident resolves
2. CDP existing optimizations shipped (dedup, indexes, cron 15m)
3. CDP verified stable 3–5 days
4. Then run `schema.sql` in Supabase
5. Ship audit worker + Lark column extensions
6. Spot-check 10 leads → refine prompt → open to Ops

## Files in this dir
- `schema.sql` — CREATE TABLE statements (safe to review offline)
- `prompt-missing-tags.ts` — LLM prompt + validation
- `test-prompt-locally.ts` — local sanity test (no Supabase needed)
- `README.md` — this file

## Open questions
- **AI cost hard cap** — need a monthly ceiling ($20?) that stops audit if exceeded, to prevent runaway cost.
- **Feedback loop** — how does Giàu tell us "AI wrong on this finding"? Considering: a Lark checkbox "Sai" that we log for prompt tuning.

## Resolved
- **Tag whitelist** ✅ Loaded dynamically via `loadAllowedSmaxTags(admin)` — union of every distinct value in `dim_lead.smax_tags`. New classes (K64, K65…) appear automatically after the next SMAX ETL run. No code redeploy.
