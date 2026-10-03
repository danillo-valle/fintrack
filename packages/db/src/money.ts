// A ponte entre o dinheiro do banco e o dinheiro do código.
//
//   banco: NUMERIC(14,2)  ⇄  Prisma.Decimal  ⇄  texto "1234.56"  ⇄  bigint em centavos (core)
//
// O Prisma lê uma coluna NUMERIC como Prisma.Decimal (a biblioteca decimal.js), que é exata.
// O resto do FinTrack trabalha com bigint em centavos (@fintrack/core). A conversão passa
// SEMPRE por texto: nunca por number, onde 0,1 + 0,2 vira 0,30000000000000004.
import { centsToDecimal, decimalToCents, fitsInColumn, type Cents } from "@fintrack/core";
import { Prisma } from "./generated/prisma/client";

/** Centavos → valor para gravar no banco: toDbDecimal(-123456n) = Decimal("-1234.56"). */
export function toDbDecimal(cents: Cents): Prisma.Decimal {
  if (!fitsInColumn(cents)) {
    throw new Error(`Valor fora do limite da coluna NUMERIC(14,2): ${centsToDecimal(cents)}`);
  }
  return new Prisma.Decimal(centsToDecimal(cents));
}

/**
 * Valor lido do banco → centavos: fromDbDecimal(Decimal("-1234.56")) = -123456n.
 * `toFixed(2)` aqui é o do decimal.js (texto exato), não o Number.prototype.toFixed.
 */
export function fromDbDecimal(value: Prisma.Decimal): Cents {
  // A única exceção à trava de dinheiro do ESLint, e de propósito: este toFixed é o do
  // decimal.js, que devolve texto exato. A regra existe para o toFixed de number.
  // eslint-disable-next-line no-restricted-properties
  return decimalToCents(value.toFixed(2));
}

/** Para colunas opcionais (creditLimit, total da fatura): null continua null. */
export function fromDbDecimalOrNull(value: Prisma.Decimal | null): Cents | null {
  return value === null ? null : fromDbDecimal(value);
}
