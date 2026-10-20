// A resposta do POST /v1/ia/sugerir do serviço Python (M10.2b) traduzida para o core. Puro (sem
// "server-only"), para o teste.
import type { LocalAiAnswer } from "@fintrack/core";

export type Situacao = "SUGERIU" | "NOVA" | "NENHUMA" | "BARRADA" | "INVALIDA";
export type LocalAiResponse = {
  situacao: Situacao;
  categoria: string | null;
  nova: { nome: string; mae: string | null } | null;
};

/** Traduz a resposta do serviço Python para o core. Resposta incompleta = INVÁLIDA. */
export function toLocalAiAnswer(data: LocalAiResponse): LocalAiAnswer {
  switch (data.situacao) {
    case "SUGERIU":
      return data.categoria
        ? { outcome: "SUGGESTED", category: data.categoria }
        : { outcome: "INVALID" };
    case "NOVA":
      return data.nova
        ? { outcome: "NEW_CATEGORY", name: data.nova.nome, parent: data.nova.mae ?? null }
        : { outcome: "INVALID" };
    case "NENHUMA":
      return { outcome: "NO_SUGGESTION" };
    case "BARRADA":
      return { outcome: "BLOCKED" };
    default:
      return { outcome: "INVALID" };
  }
}
