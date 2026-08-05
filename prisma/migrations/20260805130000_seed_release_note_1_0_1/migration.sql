INSERT INTO "release_notes" (
  "id",
  "version",
  "title",
  "summary",
  "hero_image_url",
  "blocks",
  "published",
  "published_at",
  "created_at",
  "updated_at"
)
VALUES (
  'release-note-1-0-1',
  '1.0.1',
  'Um repositório mais visual e fácil de explorar',
  'A navegação está mais organizada, as categorias ganharam uma identidade visual e as pré-visualizações das comunicações estão mais claras, rápidas e próximas do resultado final.',
  NULL,
  '[
    {
      "title": "Categorias mais visuais",
      "description": "As categorias passam a suportar imagens próprias, tornando mais fácil reconhecê-las e navegar pelo repositório de forma rápida e intuitiva."
    },
    {
      "title": "Uma ordem mais clara",
      "description": "A ordenação das categorias, subcategorias e listas foi melhorada para apresentar a informação de forma mais previsível, consistente e simples de consultar."
    },
    {
      "title": "Pré-visualizações melhoradas",
      "description": "As pré-visualizações das comunicações foram refinadas para carregar melhor e representar cada canal com mais clareza, facilitando a validação do conteúdo antes da sua utilização."
    },
    {
      "title": "Detalhes mais rápidos e consistentes",
      "description": "A consulta e atualização das comunicações está mais fluida, com menos esperas e informação atualizada de forma mais consistente depois de cada alteração."
    }
  ]'::jsonb,
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("version") DO UPDATE SET
  "title" = EXCLUDED."title",
  "summary" = EXCLUDED."summary",
  "hero_image_url" = EXCLUDED."hero_image_url",
  "blocks" = EXCLUDED."blocks",
  "published" = EXCLUDED."published",
  "published_at" = COALESCE("release_notes"."published_at", EXCLUDED."published_at"),
  "updated_at" = CURRENT_TIMESTAMP;
