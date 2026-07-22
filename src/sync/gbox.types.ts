export type GboxLocalizedVersion = {
  iTicketID?: string | number;
  text?: string;
  templateFilename?: string;
  vars?: Record<string, unknown>;
};

export type GboxVersion = {
  versao?: string;
  dataVersao?: string;
  [locale: string]: string | GboxLocalizedVersion | undefined;
};

export type GboxTemplate = {
  nome?: string;
  desc?: string;
  categoria?: string[];
  subcategoria?: string[];
  equipa?: string[];
  servico?: string[];
  tags?: string | string[];
  templateFolder?: string;
  versoes?: Record<string, GboxVersion>;
  [key: string]: unknown;
};

export type GboxTemplates = Record<
  string,
  Record<string, GboxTemplate> | GboxTemplate[] | null | undefined
>;

export type GboxTemplateDetail = {
  tipoSolicitado?: string;
  tipoRepositorio?: string;
  codigo?: string;
  nome?: string;
  desc?: string;
  versaoAtiva?: {
    versao?: string;
    dataVersao?: string;
    lang?: string;
    templateFilename?: string;
  };
  variaveis?: Array<{
    key: string;
    description?: string;
    placeholder?: string;
  }>;
  exemplo?: {
    conteudo?: string;
    variaveisAplicadas?: Record<string, unknown>;
  };
  previewPdf?: {
    mime: string;
    filename: string;
    base64: string;
  };
};
