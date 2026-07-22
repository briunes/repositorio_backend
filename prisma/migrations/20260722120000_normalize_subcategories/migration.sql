-- Normalize the former self-referencing category tree into dedicated
-- categories and subcategories tables. Existing communication assignments
-- are preserved and split by communication channel.
ALTER TABLE "communication_categories" DROP CONSTRAINT "communication_categories_category_id_fkey";
ALTER TABLE "categories" DROP CONSTRAINT "categories_parent_id_fkey";

ALTER TABLE "categories" RENAME TO "legacy_categories";
ALTER TABLE "communication_categories" RENAME TO "legacy_communication_categories";
ALTER TABLE "legacy_categories" RENAME CONSTRAINT "categories_pkey" TO "legacy_categories_pkey";
ALTER TABLE "legacy_communication_categories" RENAME CONSTRAINT "communication_categories_pkey" TO "legacy_communication_categories_pkey";
DROP INDEX "categories_slug_key";
DROP INDEX "categories_parent_id_sort_order_idx";
DROP INDEX "communication_categories_category_id_idx";

CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(140) NOT NULL,
    "description" VARCHAR(500),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "subcategories" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(140) NOT NULL,
    "description" VARCHAR(500),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "subcategories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "communication_subcategories" (
    "communication_id" TEXT NOT NULL,
    "subcategory_id" TEXT NOT NULL,
    CONSTRAINT "communication_subcategories_pkey" PRIMARY KEY ("communication_id", "subcategory_id")
);

-- Each existing channel becomes a top-level category. This preserves the
-- channel-specific grouping shown by the management screen.
INSERT INTO "categories" ("id", "name", "slug", "sort_order", "is_active", "created_at", "updated_at")
SELECT 'channel-' || "id", "name", lower("key"), row_number() OVER (ORDER BY "created_at", "name") - 1, "is_active", "created_at", "updated_at"
FROM "channels";

-- An unassigned group retains taxonomy rows which have no communication yet.
INSERT INTO "categories" ("id", "name", "slug", "sort_order", "is_active", "created_at", "updated_at")
VALUES ('category-unassigned', 'Geral', 'geral', 999, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- A subcategory name may legitimately occur in several categories, so create
-- one row for every former assignment/channel pair.
INSERT INTO "subcategories" ("id", "category_id", "name", "slug", "description", "sort_order", "is_active", "created_at", "updated_at")
SELECT DISTINCT
  'subcategory-' || lc."id" || '-' || ch."id",
  'channel-' || ch."id",
  lc."name",
  lc."slug",
  lc."description",
  lc."sort_order",
  lc."is_active",
  lc."created_at",
  lc."updated_at"
FROM "legacy_communication_categories" lcc
JOIN "legacy_categories" lc ON lc."id" = lcc."category_id"
JOIN "communications" co ON co."id" = lcc."communication_id"
JOIN "channels" ch ON ch."id" = co."channel_id";

INSERT INTO "communication_subcategories" ("communication_id", "subcategory_id")
SELECT lcc."communication_id", 'subcategory-' || lcc."category_id" || '-' || ch."id"
FROM "legacy_communication_categories" lcc
JOIN "communications" co ON co."id" = lcc."communication_id"
JOIN "channels" ch ON ch."id" = co."channel_id";

INSERT INTO "subcategories" ("id", "category_id", "name", "slug", "description", "sort_order", "is_active", "created_at", "updated_at")
SELECT 'subcategory-' || lc."id" || '-unassigned', 'category-unassigned', lc."name", lc."slug", lc."description", lc."sort_order", lc."is_active", lc."created_at", lc."updated_at"
FROM "legacy_categories" lc
WHERE NOT EXISTS (
  SELECT 1 FROM "legacy_communication_categories" lcc WHERE lcc."category_id" = lc."id"
);

CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");
CREATE INDEX "categories_sort_order_idx" ON "categories"("sort_order");
CREATE UNIQUE INDEX "subcategories_category_id_slug_key" ON "subcategories"("category_id", "slug");
CREATE INDEX "subcategories_category_id_sort_order_idx" ON "subcategories"("category_id", "sort_order");
CREATE INDEX "communication_subcategories_subcategory_id_idx" ON "communication_subcategories"("subcategory_id");

ALTER TABLE "subcategories" ADD CONSTRAINT "subcategories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_subcategories" ADD CONSTRAINT "communication_subcategories_communication_id_fkey" FOREIGN KEY ("communication_id") REFERENCES "communications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_subcategories" ADD CONSTRAINT "communication_subcategories_subcategory_id_fkey" FOREIGN KEY ("subcategory_id") REFERENCES "subcategories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP TABLE "legacy_communication_categories";
DROP TABLE "legacy_categories";
