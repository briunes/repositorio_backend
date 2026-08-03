UPDATE "release_notes"
SET
  "hero_image_url" = '/whats-new/1.0.0/hero.png',
  "blocks" = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          "blocks",
          '{0,imageUrl}',
          '"/whats-new/1.0.0/communications-listing.png"'::jsonb
        ),
        '{1,imageUrl}',
        '"/whats-new/1.0.0/categories.png"'::jsonb
      ),
      '{2,imageUrl}',
      '"/whats-new/1.0.0/edit-taxonomy.png"'::jsonb
    ),
    '{3,imageUrl}',
    '"/whats-new/1.0.0/previews.png"'::jsonb
  ),
  "updated_at" = CURRENT_TIMESTAMP
WHERE "version" = '1.0.0';
