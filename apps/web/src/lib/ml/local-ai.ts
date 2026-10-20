// A IA local vista pelo app (M10.2b, ADR-016): a porta `LocalAiPort` do core, falando HTTP com o
// serviço Python (ML_SERVICE_URL). O app nunca fala com o llama-server: só o serviço ml, que é o
// único na rede interna `llm`.
//
// Quem chama é só a fila da noite (QUEUE_SUBJECT), nunca uma tela: a IA não está no caminho do
// lançamento (os 10 s do M07). O que vai: a descrição, o tipo e os NOMES das categorias do lar.
// Nada disso vai para o log, nem aqui nem no serviço (lá só a situação).
import "server-only";
import { type LocalAiPort, type LocalAiQuestion, LocalAiUnavailable } from "@fintrack/core";
import { env } from "@/lib/env";
import { mlServiceToken } from "@/lib/auth/ml-token";
import { toLocalAiAnswer, type LocalAiResponse } from "./local-ai-answer";

/** O 1º pedido lê o modelo do disco (20 s no M10.2a); o serviço desiste em 120 s. */
export const LOCAL_AI_TIMEOUT_MS = 130_000;
export const LOCAL_AI_STATE_TIMEOUT_MS = 5_000;

/**
 * A porta da IA local em nome da fila. null quando o serviço não está configurado: a fila não
 * roda (e o lar continua com as quatro camadas).
 */
export function localAiPort(subject: string): LocalAiPort | null {
  const base = env.ML_SERVICE_URL;
  if (!base) return null;
  // Um token por noite de trabalho seria mais que os 2 min de validade: assina a cada pedido
  // (um pedido leva segundos; assinar é barato perto disso)
  const headers = async (json: boolean) => ({
    authorization: `Bearer ${await mlServiceToken(subject)}`,
    ...(json ? { "content-type": "application/json" } : {}),
  });
  return {
    async ready() {
      try {
        const response = await fetch(new URL("/v1/ia/estado", base), {
          headers: await headers(false),
          signal: AbortSignal.timeout(LOCAL_AI_STATE_TIMEOUT_MS),
          cache: "no-store",
        });
        if (!response.ok) return false;
        const data = (await response.json()) as { pronta?: boolean };
        return data.pronta === true;
      } catch {
        return false;
      }
    },
    async suggest(question: LocalAiQuestion) {
      let response: Response;
      try {
        response = await fetch(new URL("/v1/ia/sugerir", base), {
          method: "POST",
          headers: await headers(true),
          body: JSON.stringify({
            descricao: question.description.slice(0, 200),
            tipo: question.kind,
            categorias: question.categories,
            maes: question.parents,
          }),
          signal: AbortSignal.timeout(LOCAL_AI_TIMEOUT_MS),
          cache: "no-store",
        });
      } catch {
        throw new LocalAiUnavailable();
      }
      // 422 = a lista do lar não serve (nome repetido...): esse lançamento fica como INVÁLIDO
      if (response.status === 422) return { outcome: "INVALID" };
      if (!response.ok) throw new LocalAiUnavailable(`HTTP ${response.status}`);
      return toLocalAiAnswer((await response.json()) as LocalAiResponse);
    },
  };
}
