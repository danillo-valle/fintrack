// O que as capturas do README usam (M12.2): a conta de teste, a sessão e a lista das telas.

/** A sessão da conta das capturas (a pasta e2e/.auth está no .gitignore). */
export const CAPTURE_AUTH_FILE = "e2e/.auth/capturas.json";

/** A conta de TESTE das capturas: entra na casa fictícia do seed como membro (SEED_VIEWER_EMAIL). */
export const CAPTURE_USER = {
  email: "capturas@fintrack.test",
  password: "frase longa da conta das capturas",
  name: "Visita",
};

/** Onde as capturas são gravadas, a partir de apps/web. */
export const CAPTURE_DIR = "../../docs/capturas";

/**
 * As telas: o nome do arquivo, o caminho e em que aparelhos. O celular fica só com as telas que a
 * pessoa mais abre no dia a dia; o computador mostra o painel inteiro.
 */
export type CaptureDevice = "computador" | "celular";

export const SCREENS: { name: string; path: string; devices: CaptureDevice[] }[] = [
  { name: "inicio", path: "/", devices: ["computador", "celular"] },
  { name: "lancamentos", path: "/lancamentos", devices: ["computador", "celular"] },
  { name: "orcamento", path: "/orcamento", devices: ["computador"] },
  { name: "fluxo-de-caixa", path: "/orcamento/fluxo", devices: ["computador"] },
  { name: "evolucao", path: "/orcamento/evolucao", devices: ["computador"] },
];
