CREATE TABLE "communication_comments" (
    "id" TEXT NOT NULL,
    "communication_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communication_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "communication_comments_communication_id_created_at_idx"
ON "communication_comments"("communication_id", "created_at");

CREATE INDEX "communication_comments_author_id_created_at_idx"
ON "communication_comments"("author_id", "created_at");

ALTER TABLE "communication_comments"
ADD CONSTRAINT "communication_comments_communication_id_fkey"
FOREIGN KEY ("communication_id") REFERENCES "communications"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "communication_comments"
ADD CONSTRAINT "communication_comments_author_id_fkey"
FOREIGN KEY ("author_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE public."communication_comments" ENABLE ROW LEVEL SECURITY;
