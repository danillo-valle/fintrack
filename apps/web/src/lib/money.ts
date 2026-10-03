// Dinheiro no FinTrack, na interface.
//
// Regra: dinheiro NUNCA é `number`. Um number guarda 0,1 + 0,2 como 0,30000000000000004.
// Na tela, o valor vive em CENTAVOS como `bigint` (inteiro exato, sem limite prático).
// Nas bordas (formulário, API, banco) ele viaja como texto decimal: "1234.56".
//
// As regras puras (conversão, soma, rateio, parcelas) moram em @fintrack/core desde o M04.
// Este arquivo guarda só o que é da tela: formatar em reais e a digitação estilo maquininha.
import { centsToDecimal } from "@fintrack/core";

// Reexporta a conversão para quem já importava daqui (as telas do M02 e do M03)
export { centsToDecimal, decimalToCents } from "@fintrack/core";

const MAX_DIGITS = 11; // até R$ 999.999.999,99

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/**
 * Formata centavos em reais: 123456n → "R$ 1.234,56".
 * O Intl recebe o valor como texto decimal, então não há conversão para number.
 */
export function formatBRL(cents: bigint): string {
  return brl.format(centsToDecimal(cents) as `${number}`);
}

/**
 * Lê o que a pessoa digitou no campo de valor e devolve centavos.
 * Os dígitos entram pela direita, como numa maquininha: "1", "12", "123" → R$ 0,01, R$ 0,12, R$ 1,23.
 */
export function digitsToCents(typed: string): bigint {
  const digits = typed.replace(/\D/g, "").replace(/^0+/, "").slice(0, MAX_DIGITS);
  return digits === "" ? 0n : BigInt(digits);
}

/** Acrescenta dígitos à direita: 12n + "3" → 123n. Ignora o que passar de 11 dígitos. */
export function appendDigits(cents: bigint, typed: string): bigint {
  return digitsToCents(`${cents}${typed.replace(/\D/g, "")}`);
}

/** Apaga o último dígito: 1234n → 123n */
export function dropLastDigit(cents: bigint): bigint {
  return cents / 10n;
}
