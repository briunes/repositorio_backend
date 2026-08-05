UPDATE "release_notes"
SET
  "hero_image_url" = '/whats-new/1.0.1/hero.jpg',
  "blocks" = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          "blocks",
          '{0,imageUrl}',
          '"/whats-new/1.0.1/categories.jpg"'::jsonb
        ),
        '{1,imageUrl}',
        '"/whats-new/1.0.1/ordering.jpg"'::jsonb
      ),
      '{2,imageUrl}',
      '"/whats-new/1.0.1/previews.jpg"'::jsonb
    ),
    '{3,imageUrl}',
    '"/whats-new/1.0.1/details.jpg"'::jsonb
  ),
  "updated_at" = CURRENT_TIMESTAMP
WHERE "version" = '1.0.1';
