// ESLint do @fintrack/importers: a configuração compartilhada com a trava de dinheiro. Valores do
// banco chegam como texto exato (exact-json.ts) e viram centavos sem passar por number.
import { fintrackBase, moneyGuard } from "@fintrack/config/eslint";

export default [...fintrackBase, moneyGuard(["src/**/*.ts"])];
