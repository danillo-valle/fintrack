// Classes repetidas em vários lugares, guardadas num só para não divergirem.

/**
 * Link de texto (ex.: "Voltar para a entrada", "Criar conta"). O foco usa o anel de 3px do tema,
 * como os botões e campos; sem isto, o navegador desenha o contorno fino dele, que some em fundo
 * claro e reprova o teste foco-visivel.spec.ts ("usa o contorno do navegador").
 */
export const TEXT_LINK =
  "text-primary focus-visible:ring-ring rounded-sm underline underline-offset-4 outline-none focus-visible:ring-3";

/**
 * Número que leva aos lançamentos que o compõem (M08): sublinhado pontilhado, que vira contínuo
 * no mouse. É o sinal, no painel inteiro, de "este número tem caminho até a lista".
 */
export const NUMBER_LINK =
  "focus-visible:ring-ring rounded-sm underline decoration-dotted decoration-1 underline-offset-4 outline-none hover:decoration-solid focus-visible:ring-3";

/**
 * Caixa de marcar e botão de rádio nativos (M13.3b): a cor do tema e o anel de 3px no foco, como os
 * outros campos. Sem isto, o navegador desenha o contorno dele (reprova o foco-visivel.spec.ts).
 */
export const NATIVE_CHECK =
  "accent-primary focus-visible:ring-ring shrink-0 rounded outline-none focus-visible:ring-3";
