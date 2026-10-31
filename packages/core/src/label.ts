// O "O que foi" (M13.2, adendo do ADR-012): o nome que a pessoa dá a um lançamento do banco.
// A descrição continua o texto da origem (é dela que a categorização e a busca do banco leem); o
// "O que foi" aparece em destaque, com o texto do banco embaixo. Regras puras:
//
//   hasOriginText           o lançamento tem texto de origem (banco, OFX, PDF): ele recebe o "O que foi"
//   shownText               o que a tela mostra em destaque
//   sameText                dois textos que dizem o mesmo (o "O que foi" igual ao banco não se guarda)
//   installmentStem         a descrição de uma parcela sem o "NN/NN" do fim
//   installmentSiblingKey   a chave que junta as parcelas da mesma compra que vieram do banco
import { matchText } from "./categorization";
import type { Cents } from "./money";

/** De onde vem um texto de origem: neles a descrição não muda e o nome da pessoa é o "O que foi". */
export const ORIGIN_TEXT_SOURCES = ["OPEN_FINANCE", "OFX", "PDF"] as const;

export function hasOriginText(source: string): boolean {
  return (ORIGIN_TEXT_SOURCES as readonly string[]).includes(source);
}

/** O texto em destaque: o "O que foi" quando a pessoa deu um; senão a descrição. */
export function shownText(t: { label: string | null; description: string }): string {
  return t.label ?? t.description;
}

/** Dois textos iguais depois de tirar acentos, caixa e pontuação. */
export function sameText(a: string, b: string): boolean {
  return matchText(a) === matchText(b);
}

// O número da parcela que o banco cola no fim: "LOJA 03/10", "LOJA*MERCA03/03", "LOJA 3 DE 10".
// Os espaços têm limite e o fim é cortado antes: nenhum trecho do texto é relido várias vezes
// (uma descrição cheia de espaços não deixa a expressão lenta).
const INSTALLMENT_SUFFIX = /(?:\d{1,2}\s{0,2}\/\s{0,2}\d{1,2}|\d{1,2}\s{1,2}de\s{1,2}\d{1,2})$/i;

/** A descrição da parcela sem o número dela ("MERCADOLIVRE*MERCA03/03" → "MERCADOLIVRE*MERCA"). */
export function installmentStem(description: string): string {
  return description.trimEnd().replace(INSTALLMENT_SUFFIX, "").trim();
}

/**
 * A chave das parcelas da mesma compra que vieram do banco: mesma conta, mesmo valor, mesmo
 * total de parcelas e a mesma descrição sem o "NN/NN". null para o que não é parcela.
 */
export function installmentSiblingKey(t: {
  accountId: string;
  amount: Cents;
  description: string;
  installmentCount: number | null;
}): string | null {
  if (t.installmentCount === null || t.installmentCount < 2) return null;
  const stem = matchText(installmentStem(t.description));
  if (!stem) return null;
  return `${t.accountId}|${t.amount}|${t.installmentCount}|${stem}`;
}
