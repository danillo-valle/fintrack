// JSON com dinheiro EXATO. JSON.parse comum transforma 312.48 em number (ponto flutuante): somas
// de muitos valores perdem centavos. Aqui, todo número chega como o TEXTO que estava na resposta
// ("312.48"), e só vira centavos (bigint) por moneyFromText. Usa o "source text access" do
// JSON.parse (o terceiro argumento do reviver, presente no Node 24).
import type { Cents } from "@fintrack/core";

/** Um valor JSON em que todo número é o texto original. */
export type ExactJson = string | boolean | null | ExactJson[] | { [key: string]: ExactJson };

type ReviverContext = { source?: string };

export function parseExactJson(text: string): ExactJson {
  return JSON.parse(
    text,
    function (this: unknown, _key: string, value: unknown, context?: ReviverContext) {
      if (typeof value === "number") {
        if (!context || typeof context.source !== "string") {
          // Sem o texto original não dá para garantir os centavos: melhor parar do que errar
          throw new Error("JSON.parse sem source text access (use Node 24 ou mais novo)");
        }
        return context.source;
      }
      return value;
    },
  ) as ExactJson;
}

const DECIMAL_RE = /^(-)?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/**
 * Converte o texto de um valor ("312.48", "-0.5", "1e2", "48.615") em centavos.
 * Mais de 2 casas (câmbio às vezes vem com 3): arredonda meio para longe de zero na 3ª casa,
 * como os bancos fazem na fatura. Texto que não é número: null.
 */
export function moneyFromText(text: string): Cents | null {
  const match = DECIMAL_RE.exec(text.trim());
  if (!match) return null;
  const [, sign, int = "0", frac = "", exp = "0"] = match;
  // Desloca a vírgula pelo expoente sem passar por number
  let digits = int + frac;
  let point = int.length + Number.parseInt(exp, 10);
  if (point < 0) {
    digits = "0".repeat(-point) + digits;
    point = 0;
  }
  if (point > digits.length) digits = digits.padEnd(point, "0");
  const units = digits.slice(0, point) || "0";
  const decimals = digits.slice(point);
  const cents2 = decimals.slice(0, 2).padEnd(2, "0");
  let cents = BigInt(units) * 100n + BigInt(cents2);
  const third = decimals.charAt(2);
  if (third !== "" && third >= "5") cents += 1n;
  return sign ? -cents : cents;
}
