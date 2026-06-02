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
