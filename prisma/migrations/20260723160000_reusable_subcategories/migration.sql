-- Make subcategories reusable across categories while preserving every
-- existing category/subcategory and communication taxonomy pair.

CREATE TABLE "category_subcategories" (
    "category_id" TEXT NOT NULL,
    "subcategory_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "category_subcategories_pkey" PRIMARY KEY ("category_id", "subcategory_id")
);

-- Pick one canonical subcategory for each slug. Existing rows used a
-- category-scoped uniqueness rule, so the same logical item may exist more
-- than once.
CREATE TEMP TABLE "subcategory_merge_map" AS
SELECT
    "id" AS "old_id",
    FIRST_VALUE("id") OVER (
      PARTITION BY "slug"
      ORDER BY ("description" IS NOT NULL) DESC, "created_at" ASC, "id" ASC
    ) AS "canonical_id"
FROM "subcategories";

INSERT INTO "category_subcategories" ("category_id", "subcategory_id", "sort_order")
SELECT s."category_id", m."canonical_id", MIN(s."sort_order")
FROM "subcategories" s
JOIN "subcategory_merge_map" m ON m."old_id" = s."id"
GROUP BY s."category_id", m."canonical_id";

ALTER TABLE "communication_subcategories" DROP CONSTRAINT "communication_subcategories_pkey";
ALTER TABLE "communication_subcategories" ADD COLUMN "category_id" TEXT;

UPDATE "communication_subcategories" cs
SET
  "category_id" = s."category_id",
  "subcategory_id" = m."canonical_id"
FROM "subcategories" s
JOIN "subcategory_merge_map" m ON m."old_id" = s."id"
WHERE cs."subcategory_id" = s."id";

ALTER TABLE "communication_subcategories" ALTER COLUMN "category_id" SET NOT NULL;

-- Remove duplicates that can appear after canonicalizing repeated names.
DELETE FROM "communication_subcategories" a
USING "communication_subcategories" b
WHERE a.ctid < b.ctid
  AND a."communication_id" = b."communication_id"
  AND a."category_id" = b."category_id"
  AND a."subcategory_id" = b."subcategory_id";

DELETE FROM "subcategories" s
USING "subcategory_merge_map" m
WHERE s."id" = m."old_id" AND m."old_id" <> m."canonical_id";

ALTER TABLE "subcategories" DROP CONSTRAINT "subcategories_category_id_fkey";
DROP INDEX "subcategories_category_id_slug_key";
DROP INDEX "subcategories_category_id_sort_order_idx";
ALTER TABLE "subcategories" DROP COLUMN "category_id";

CREATE UNIQUE INDEX "subcategories_slug_key" ON "subcategories"("slug");
CREATE INDEX "subcategories_sort_order_idx" ON "subcategories"("sort_order");
CREATE INDEX "category_subcategories_subcategory_id_idx" ON "category_subcategories"("subcategory_id");
CREATE INDEX "category_subcategories_category_id_sort_order_idx" ON "category_subcategories"("category_id", "sort_order");
CREATE INDEX "communication_subcategories_category_id_idx" ON "communication_subcategories"("category_id");

ALTER TABLE "category_subcategories" ADD CONSTRAINT "category_subcategories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "category_subcategories" ADD CONSTRAINT "category_subcategories_subcategory_id_fkey" FOREIGN KEY ("subcategory_id") REFERENCES "subcategories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_subcategories" ADD CONSTRAINT "communication_subcategories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_subcategories" ADD CONSTRAINT "communication_subcategories_pkey" PRIMARY KEY ("communication_id", "category_id", "subcategory_id");

