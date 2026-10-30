// O texto que chega de fora (formulário, endereço, mensagem do bot, arquivo ou API do banco),
// limpo uma vez, na entrada, ANTES de qualquer conferência (M12.4a, achado da varredura ativa do
// ZAP). Dois motivos:
//   1. O Postgres não guarda o caractere nulo (U+0000): um "\0" num filtro ou num nome virava
//      erro 500 em vez de ser ignorado ou recusado com uma mensagem.
//   2. Um caractere invisível no meio esconde o que o texto parece: "4111<invisível>1111..." passa
//      pela conferência de número de cartão do bot e aparece na tela como um número inteiro.
// Por isso a limpeza vem antes da conferência, e não no banco: limpar só na hora de gravar faria a
// conferência olhar um texto e o banco guardar outro.

/**
 * Os caracteres invisíveis de formatação (\p{Cf}: largura zero, direção do texto, BOM...) e as
 * metades soltas de um par UTF-16 (\p{Cs}), que não são texto
 */
const INVISIBLE = /[\p{Cf}\p{Cs}]/gu;
/** Os de controle (\p{Cc}): os que separam palavras (tabulação, quebras) viram espaço */
const CONTROL = /\p{Cc}/gu;
const SPACE_LIKE = /^[\t\n\v\f\r\u0085]$/;
/** Os espaços "diferentes" (sem quebra, fino, de número...) e os separadores de linha/parágrafo */
const ODD_SPACE = /[\p{Zs}\u2028\u2029]/gu;

/**
 * O texto numa linha só, sem caracteres invisíveis nem de controle, com os espaços diferentes
 * trocados pelo espaço comum. Não apara as pontas nem limita o tamanho: isso é de cada campo (o
 * `.trim().max()` do zod).
 *
 * Os emojis de família e de profissão (unidos por um caractere invisível) viram os emojis
 * separados: o preço de nenhum invisível passar.
 */
export function cleanText(text: string): string {
  return text
    .replace(INVISIBLE, "")
    .replace(CONTROL, (c) => (SPACE_LIKE.test(c) ? " " : ""))
    .replace(ODD_SPACE, " ");
}
