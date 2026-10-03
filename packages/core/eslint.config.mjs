// ESLint do @fintrack/core: a configuração compartilhada do monorepo com a trava de dinheiro.
import { fintrackBase, moneyGuard } from "@fintrack/config/eslint";

export default [...fintrackBase, moneyGuard(["src/**/*.ts"])];
