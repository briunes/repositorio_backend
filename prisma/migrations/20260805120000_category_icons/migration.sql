ALTER TABLE public.categories
ADD COLUMN icon_data text;

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
          'iconData', c.icon_data,
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
