// pnpm --filter @fintrack/flow-map generate: grava o mapa do fluxo em docs/arquitetura/fluxo.json.
// O teste "o mapa está em dia" falha se alguém mudar uma tela e esquecer de rodar isto.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { analyze } from "./analyze";
import { serialize } from "./serialize";

export const ROOT = path.resolve(import.meta.dirname, "../../..");
export const OUTPUT = path.join(ROOT, "docs/arquitetura/fluxo.json");

const map = analyze(ROOT);
writeFileSync(OUTPUT, serialize(map));
console.warn(
  `fluxo.json: ${map.screens.length} telas, ${map.actions.length} actions, ${map.loaders.length} carregamentos, ` +
    `${map.apis.length} rotas de API, ${map.queues.length} filas, ${map.db.length} funções do banco`,
);
