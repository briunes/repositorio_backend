-- Runtime reads use this PostgREST RPC. Prisma remains migration-only.
CREATE OR REPLACE FUNCTION public.get_repository_taxonomy()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'categories', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'sortOrder', c.sort_order,
          'children', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', s.id,
                'name', s.name,
                'description', s.description,
                'sortOrder', cs.sort_order
              ) ORDER BY cs.sort_order, s.name
            )
            FROM public.category_subcategories cs
            JOIN public.subcategories s ON s.id = cs.subcategory_id
            WHERE cs.category_id = c.id AND s.is_active = true
          ), '[]'::jsonb)
        ) ORDER BY c.sort_order, c.name
      )
      FROM public.categories c
      WHERE c.is_active = true
    ), '[]'::jsonb),
    'subcategories', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'name', s.name,
          'description', s.description,
          'sortOrder', s.sort_order
        ) ORDER BY s.sort_order, s.name
      )
      FROM public.subcategories s
      WHERE s.is_active = true
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.get_repository_taxonomy() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_repository_taxonomy() TO service_role;

CREATE OR REPLACE FUNCTION public.get_repository_filters()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'categories', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'slug', slug) ORDER BY sort_order, name) FROM categories WHERE is_active), '[]'::jsonb),
    'subcategories', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'description', s.description, 'parentId', cs.category_id) ORDER BY cs.sort_order, s.name)
      FROM category_subcategories cs
      JOIN subcategories s ON s.id = cs.subcategory_id
      JOIN categories c ON c.id = cs.category_id
      WHERE s.is_active AND c.is_active
    ), '[]'::jsonb),
    'services', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'slug', slug) ORDER BY name) FROM services WHERE is_active), '[]'::jsonb),
    'teams', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'slug', slug) ORDER BY name) FROM teams WHERE is_active), '[]'::jsonb),
    'tags', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'slug', slug) ORDER BY name) FROM tags), '[]'::jsonb),
    'channels', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'key', key, 'name', name) ORDER BY name) FROM channels WHERE is_active), '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.assign_repository_subcategory(
  p_category_id text,
  p_subcategory_id text,
  p_requested_position integer DEFAULT NULL
)
RETURNS TABLE(
  "categoryId" text,
  "categoryName" text,
  "subcategoryId" text,
  inserted boolean,
  "requestedPosition" integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_category_name text;
  v_inserted boolean := false;
  v_position integer;
BEGIN
  SELECT name INTO v_category_name FROM categories
  WHERE id = p_category_id AND is_active;
  IF v_category_name IS NULL OR NOT EXISTS (
    SELECT 1 FROM subcategories WHERE id = p_subcategory_id AND is_active
  ) THEN RETURN; END IF;

  INSERT INTO category_subcategories(category_id, subcategory_id, sort_order)
  VALUES (
    p_category_id,
    p_subcategory_id,
    COALESCE((SELECT max(sort_order) + 1 FROM category_subcategories WHERE category_id = p_category_id), 0)
  ) ON CONFLICT (category_id, subcategory_id) DO NOTHING;
  GET DIAGNOSTICS v_position = ROW_COUNT;
  v_inserted := v_position = 1;
  SELECT least(
    COALESCE(p_requested_position, count(*)::integer),
    count(*)::integer
  ) INTO v_position FROM category_subcategories WHERE category_id = p_category_id;

  RETURN QUERY SELECT p_category_id, v_category_name, p_subcategory_id, v_inserted, v_position;
END;
$$;

CREATE OR REPLACE FUNCTION public.position_repository_subcategory(
  p_category_id text,
  p_subcategory_id text,
  p_requested_position integer
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  WITH ranked AS (
    SELECT subcategory_id,
      row_number() OVER (ORDER BY sort_order, subcategory_id) - 1 AS position
    FROM category_subcategories
    WHERE category_id = p_category_id AND subcategory_id <> p_subcategory_id
  ), shifted AS (
    UPDATE category_subcategories cs
    SET sort_order = CASE WHEN ranked.position >= p_requested_position
      THEN ranked.position + 1 ELSE ranked.position END
    FROM ranked
    WHERE cs.category_id = p_category_id
      AND cs.subcategory_id = ranked.subcategory_id
  )
  UPDATE category_subcategories
  SET sort_order = p_requested_position
  WHERE category_id = p_category_id AND subcategory_id = p_subcategory_id;
$$;

CREATE OR REPLACE FUNCTION public.update_repository_snapshot_taxonomy(
  p_channel text,
  p_code text,
  p_categories jsonb,
  p_subcategories jsonb
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE repository_snapshots
  SET payload = jsonb_set(
    jsonb_set(payload, ARRAY[p_channel, p_code, 'categoria'], p_categories, true),
    ARRAY[p_channel, p_code, 'subcategoria'], p_subcategories, true
  ), synced_at = now()
  WHERE key = 'gbox-templates';
$$;

REVOKE ALL ON FUNCTION public.get_repository_filters() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_repository_subcategory(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.position_repository_subcategory(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_repository_snapshot_taxonomy(text, text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_repository_filters() TO service_role;
GRANT EXECUTE ON FUNCTION public.assign_repository_subcategory(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.position_repository_subcategory(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_repository_snapshot_taxonomy(text, text, jsonb, jsonb) TO service_role;
