// ESLint do @fintrack/db: a configuração compartilhada, com a trava de dinheiro no código
// escrito à mão (o cliente gerado em src/generated fica de fora).
import { fintrackBase, moneyGuard } from "@fintrack/config/eslint";

export default [...fintrackBase, moneyGuard(["src/**/*.ts", "prisma/**/*.ts"])];
