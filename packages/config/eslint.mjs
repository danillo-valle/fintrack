// ESLint compartilhado pelos pacotes do monorepo (packages/core e packages/db).
// O app web tem a própria configuração (eslint-config-next); estes pacotes não usam React.
//
// Uso, no eslint.config.mjs do pacote:
//   import { fintrackBase, moneyGuard } from "@fintrack/config/eslint";
//   export default [...fintrackBase, moneyGuard(["src/**/*.ts"])];
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** Regras gerais: as recomendadas do JavaScript e do TypeScript, mais as do CLAUDE.md. */
export const fintrackBase = [
  { ignores: ["**/generated/**", "**/node_modules/**", "**/dist/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Nada de console.log esquecido; console.warn e console.error continuam liberados
      "no-console": ["error", { allow: ["warn", "error"] }],
      // "any" desliga a checagem de tipos: proibido
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
];

const MONEY_MESSAGE =
  "Dinheiro é bigint em centavos (Cents). number perde centavos (0,1 + 0,2) e acima de 2^53. " +
  "Use centsToDecimal/decimalToCents do @fintrack/core.";

/**
 * A trava de dinheiro: proíbe as conversões que fazem um valor monetário virar `number`.
 * Os tipos já impedem misturar bigint com number; esta regra pega o caminho de volta
 * (texto → number) e o arredondamento por toFixed, que é onde os centavos somem.
 *
 * @param {string[]} files arquivos vigiados (globs relativos ao pacote)
 */
export function moneyGuard(files) {
  return {
    files,
    rules: {
      "no-restricted-globals": ["error", { name: "parseFloat", message: MONEY_MESSAGE }],
      // Number(valor) e new Number(valor): convertem texto ou bigint em number
      "no-restricted-syntax": [
        "error",
        { selector: "CallExpression[callee.name='Number']", message: MONEY_MESSAGE },
        { selector: "NewExpression[callee.name='Number']", message: MONEY_MESSAGE },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Number", property: "parseFloat", message: MONEY_MESSAGE },
        { object: "Math", property: "round", message: MONEY_MESSAGE },
        { property: "toFixed", message: MONEY_MESSAGE },
        { property: "toPrecision", message: MONEY_MESSAGE },
      ],
    },
  };
}
