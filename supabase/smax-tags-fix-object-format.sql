-- ============================================================================
-- Fix SMAX tags: extract only `name` field from tag objects
-- ============================================================================
-- SMAX API returns tags as objects: {id, name, time, alias}
-- Previous backfill stored the full JSON string. This fixes it to keep only names.
-- ============================================================================

UPDATE dim_lead l
SET smax_tags = COALESCE(agg.tags, '{}')
FROM (
  SELECT
    ft.lead_id,
    ARRAY(
      SELECT DISTINCT tag_name
      FROM (
        -- Extract from customer.tags (array of objects)
        SELECT (elem->>'name') AS tag_name
        FROM fact_touchpoint ft2, jsonb_array_elements(ft2.payload->'tags') AS elem
        WHERE ft2.lead_id = ft.lead_id
          AND ft2.source = 'smax'
          AND jsonb_typeof(ft2.payload->'tags') = 'array'
          AND jsonb_typeof(elem) = 'object'
        UNION ALL
        -- Extract from customer.tags when it's array of STRINGS (fallback for old format)
        SELECT jsonb_array_elements_text(ft2.payload->'tags') AS tag_name
        FROM fact_touchpoint ft2
        WHERE ft2.lead_id = ft.lead_id
          AND ft2.source = 'smax'
          AND jsonb_typeof(ft2.payload->'tags') = 'array'
          AND jsonb_typeof(ft2.payload->'tags'->0) = 'string'
        UNION ALL
        -- Extract from thread.tag_aliases (strings)
        SELECT jsonb_array_elements_text(ft2.payload->'tag_aliases') AS tag_name
        FROM fact_touchpoint ft2
        WHERE ft2.lead_id = ft.lead_id
          AND ft2.source = 'smax'
          AND jsonb_typeof(ft2.payload->'tag_aliases') = 'array'
      ) t
      WHERE tag_name IS NOT NULL AND tag_name <> ''
    ) AS tags
  FROM fact_touchpoint ft
  WHERE ft.source = 'smax' AND ft.lead_id IS NOT NULL
    AND (jsonb_typeof(ft.payload->'tags') = 'array' OR jsonb_typeof(ft.payload->'tag_aliases') = 'array')
  GROUP BY ft.lead_id
) agg
WHERE l.lead_id = agg.lead_id;

-- Report
SELECT
  COUNT(*) FILTER (WHERE smax_tags IS NOT NULL AND array_length(smax_tags, 1) > 0) AS leads_with_tags,
  (SELECT COUNT(DISTINCT t) FROM dim_lead, UNNEST(smax_tags) t WHERE t IS NOT NULL) AS unique_tags
FROM dim_lead;

-- Sample check
SELECT full_name, smax_tags
FROM dim_lead
WHERE source = 'smax' AND array_length(smax_tags, 1) > 0
LIMIT 5;
