// O formato do mapa do fluxo (docs/arquitetura/fluxo.json). Os nomes das chaves ficam em inglês,
// como o código; os textos para gente (área, título) em português, como a interface.

/** none: nada; user: a sessão (requireUser); recent: a senha digitada há pouco (requireRecentAuth). */
export type SessionCheck = "none" | "user" | "recent";

/**
 * Uma tela do app: uma page.tsx, inteira ou em modal (rota interceptada do @modal), ou a moldura
 * de um grupo de telas (layout.tsx, com o menu).
 */
export type Screen = {
  /** o endereço, com os segmentos dinâmicos como estão no código: /ajustes/contas/[accountId] */
  route: string;
  file: string;
  /** page: página inteira; modal: por cima da anterior; public: sem login; layout: a moldura */
  kind: "layout" | "page" | "public" | "modal";
  title: string;
  area: string;
  /** o artigo da Ajuda (o help do PageHeader), quando a tela tem um */
  help: string | null;
  /** os segmentos dinâmicos do endereço ([accountId]) */
  params: string[];
  /** os ?campos que a própria tela lê */
  searchParams: string[];
  /** as funções que a tela entrega os ?campos inteiros (elas leem os filtros) */
  searchParamsTo: string[];
  /** o que a tela pede no servidor: nada, a sessão (requireUser) ou a senha recente */
  session: SessionCheck;
  /** o que a tela carrega no servidor, antes de chegar ao navegador (ids de loaders) */
  loaders: string[];
  /** as Server Actions que os formulários e botões da tela chamam (ids de actions) */
  actions: string[];
  /** os componentes que rodam no navegador ("use client") */
  clientComponents: string[];
  /** as chamadas do navegador direto ao Better Auth (/api/auth) */
  authCalls: string[];
  /** as telas para onde a tela leva (links e botões) */
  links: string[];
};

/** Uma função do servidor: Server Action, carregamento de tela, rota de API ou trabalhador de fila. */
export type ServerFunction = {
  id: string;
  file: string;
  name: string;
  /** os campos que chegam (o schema zod que a função confere) */
  input: string[];
  /** as permissões do crachá que ela pede (requireWalletAccess/requireHouseholdAccess) */
  permissions: string[];
  /** as funções do packages/db que ela chama */
  db: string[];
  /** as tabelas que ela usa direto, sem passar pelo packages/db */
  tables: string[];
  /** as filas onde ela põe trabalho */
  enqueues: string[];
  /** os serviços de fora que ela alcança */
  services: string[];
  /** as regras puras do packages/core que ela usa */
  rules: string[];
  /** para onde ela manda o navegador depois (redirect) */
  redirects: string[];
  /** ela avisa o cache das somas (financeChanged, ADR-010) */
  financeChanged: boolean;
  /** o que ela pede antes de tudo: nada, a sessão (requireUser) ou a senha recente (requireRecentAuth) */
  session: SessionCheck;
};

export type Api = ServerFunction & { route: string; methods: string[] };

export type Queue = {
  name: string;
  /** quem põe trabalho nela (ids de funções do servidor) */
  enqueuedBy: string[];
  /** o horário fixo (cron) quando ela também roda sozinha */
  schedule: string | null;
  worker: ServerFunction | null;
};

export type DbFunction = {
  id: string;
  file: string;
  name: string;
  tables: string[];
  /** os serviços de fora que ela alcança (a busca no banco chama o Meu Pluggy) */
  services: string[];
};

export type Service = { id: string; name: string; description: string; files: string[] };

export type FlowMap = {
  version: 1;
  screens: Screen[];
  loaders: ServerFunction[];
  actions: ServerFunction[];
  apis: Api[];
  queues: Queue[];
  db: DbFunction[];
  tables: { model: string; table: string }[];
  services: Service[];
};
