import type { FlowMap } from "./model";

/** O JSON do mapa, sempre igual para o mesmo código (chaves na ordem do tipo, fim de linha no fim). */
export function serialize(map: FlowMap): string {
  return `${JSON.stringify(map, null, 2)}\n`;
}
