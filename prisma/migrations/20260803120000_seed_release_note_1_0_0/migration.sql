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
  'release-note-1-0-0',
  '1.0.0',
  'O Repositório de Comunicações chegou',
  'Encontre, organize e consulte as comunicações da Gold Energy num único espaço, com pesquisa simples, informação estruturada e pré-visualizações adaptadas a cada canal.',
  NULL,
  '[
    {
      "title": "Todas as comunicações num só lugar",
      "description": "Consulte a listagem de comunicações, pesquise por nome ou conteúdo e utilize filtros para chegar rapidamente ao template certo, seja de email, SMS ou outro canal.",
      "imageUrl": ""
    },
    {
      "title": "Organização por categoria e subcategoria",
      "description": "Navegue pelas comunicações de forma estruturada e faça a gestão das respetivas categorias e subcategorias, mantendo o repositório claro e fácil de explorar.",
      "imageUrl": ""
    },
    {
      "title": "Edição simples e controlada",
      "description": "Atualize a categoria e a subcategoria de cada comunicação diretamente no respetivo detalhe, com uma experiência rápida e focada na organização do conteúdo.",
      "imageUrl": ""
    },
    {
      "title": "Pré-visualizações por canal",
      "description": "Veja o aspeto de cada comunicação antes de a utilizar. Expanda a pré-visualização, teste emails em diferentes tamanhos de ecrã e consulte os templates em modo claro ou escuro.",
      "imageUrl": ""
    }
  ]'::jsonb,
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("version") DO NOTHING;
