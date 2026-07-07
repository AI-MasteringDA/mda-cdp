-- ============================================================================
-- SMAX Tags sync into dim_lead
-- ============================================================================
-- SMAX customer.tags[] + thread.tag_aliases[] are stored per touchpoint in
-- fact_touchpoint.payload but not aggregated to lead level. Add smax_tags
-- (text array) so we can filter/segment/push by tag.
-- ============================================================================

-- 1. Column
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS smax_tags TEXT[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_dim_lead_smax_tags ON dim_lead USING GIN (smax_tags);

-- 2. Backfill from existing fact_touchpoint payloads (tags + tag_aliases)
UPDATE dim_lead l
SET smax_tags = agg.tags
FROM (
  SELECT
    ft.lead_id,
    ARRAY(
      SELECT DISTINCT tag
      FROM (
        SELECT jsonb_array_elements_text(ft2.payload->'tags') AS tag
        FROM fact_touchpoint ft2
        WHERE ft2.lead_id = ft.lead_id
          AND ft2.source = 'smax'
          AND jsonb_typeof(ft2.payload->'tags') = 'array'
        UNION ALL
        SELECT jsonb_array_elements_text(ft2.payload->'tag_aliases') AS tag
        FROM fact_touchpoint ft2
        WHERE ft2.lead_id = ft.lead_id
          AND ft2.source = 'smax'
          AND jsonb_typeof(ft2.payload->'tag_aliases') = 'array'
      ) t
      WHERE tag IS NOT NULL AND tag <> ''
    ) AS tags
  FROM fact_touchpoint ft
  WHERE ft.source = 'smax' AND ft.lead_id IS NOT NULL
    AND (jsonb_typeof(ft.payload->'tags') = 'array' OR jsonb_typeof(ft.payload->'tag_aliases') = 'array')
  GROUP BY ft.lead_id
) agg
WHERE l.lead_id = agg.lead_id
  AND agg.tags IS NOT NULL
  AND array_length(agg.tags, 1) > 0;

-- 3. Report
SELECT
  COUNT(*) FILTER (WHERE smax_tags IS NOT NULL AND array_length(smax_tags, 1) > 0) AS leads_with_tags,
  (SELECT COUNT(DISTINCT t) FROM dim_lead, UNNEST(smax_tags) t WHERE t IS NOT NULL) AS unique_tags
FROM dim_lead;
