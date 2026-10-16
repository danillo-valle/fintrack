// O classificador do serviço Python visto pelo app (M10.1, ADR-015): a porta `ClassifierPort`
// do core, falando HTTP com o serviço na rede interna (ML_SERVICE_URL), com o mesmo token curto
// da fatura em PDF (M09.4).
//
// O que vai para o serviço: a descrição, o tipo e os ids (carteiras e categorias). Nada sai do
// servidor: em produção o serviço está numa rede sem internet. Nada disso vai para o log.
//
// Tempo: a sugestão é chamada enquanto a pessoa digita e ao salvar um lançamento (o critério dos
// 10 s do M07): 1,5 s no máximo, e se passar, a cascata segue sem o classificador. O treino
// roda na fila (madrugada) ou no "Treinar agora", com até 60 s por carteira.
import "server-only";
import type { ClassifierCandidate, ClassifierPort, TrainingExample } from "@fintrack/core";
import { mlServiceToken } from "@/lib/auth/ml-token";
import { env } from "@/lib/env";

export const SUGGEST_TIMEOUT_MS = 1_500;
export const TRAIN_TIMEOUT_MS = 60_000;
/** O "sub" do token quando quem chama é a fila (sem pessoa logada). */
export const QUEUE_SUBJECT = "fintrack:fila";

// O token vale 2 minutos: guarda um por quem chama durante 1 minuto (assinar a cada tecla
// digitada seria trabalho à toa)
const tokens = new Map<string, { token: string; until: number }>();
async function tokenFor(subject: string): Promise<string> {
  const cached = tokens.get(subject);
  if (cached && cached.until > Date.now()) return cached.token;
  const token = await mlServiceToken(subject);
  tokens.set(subject, { token, until: Date.now() + 60_000 });
  return token;
}

class ClassifierUnavailable extends Error {}

async function call(
  base: string,
  subject: string,
  path: string,
  init: { method: "POST" | "DELETE"; body?: unknown; timeoutMs: number },
): Promise<Response> {
  const response = await fetch(new URL(path, base), {
    method: init.method,
    headers: {
      authorization: `Bearer ${await tokenFor(subject)}`,
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(init.timeoutMs),
    cache: "no-store",
  });
  if (response.status === 401) tokens.delete(subject);
  return response;
}

/**
 * A porta do classificador em nome de quem chama (o id da pessoa, ou QUEUE_SUBJECT na fila).
 * null quando o serviço não está configurado: a cascata roda sem a camada.
 */
export function classifierPort(subject: string): ClassifierPort | null {
  const base = env.ML_SERVICE_URL;
  if (!base) return null;
  return {
    async suggest({ models, description, kind }) {
      const response = await call(base, subject, "/v1/classificador/sugerir", {
        method: "POST",
        body: { modelos: models, descricao: description.slice(0, 200), tipo: kind },
        timeoutMs: SUGGEST_TIMEOUT_MS,
      });
      if (!response.ok) throw new ClassifierUnavailable(`HTTP ${response.status}`);
      const data = (await response.json()) as {
        candidatos?: { categoria: string; confianca: number; modelo: string }[];
      };
      return (data.candidatos ?? []).map((c): ClassifierCandidate => ({
        categoryId: c.categoria,
        confidence: c.confianca,
        model: c.modelo,
      }));
    },
    async train({ model, examples }: { model: string; examples: readonly TrainingExample[] }) {
      const response = await call(base, subject, "/v1/classificador/treinar", {
        method: "POST",
        body: {
          modelo: model,
          exemplos: examples.map((e) => ({
            descricao: e.description.slice(0, 200),
            tipo: e.kind,
            categoria: e.categoryId,
          })),
        },
        timeoutMs: TRAIN_TIMEOUT_MS,
      });
      if (response.status === 422) {
        const { code } = (await response.json()) as { code?: string };
        if (code === "CLASSIFIER_TOO_FEW_EXAMPLES") return "TOO_FEW";
      }
      if (!response.ok) throw new ClassifierUnavailable(`HTTP ${response.status}`);
      const data = (await response.json()) as { exemplos: number; categorias: number };
      return { examples: data.exemplos, categories: data.categorias };
    },
    async remove(model) {
      const response = await call(base, subject, `/v1/classificador/${model}`, {
        method: "DELETE",
        timeoutMs: SUGGEST_TIMEOUT_MS * 4,
      });
      if (!response.ok) throw new ClassifierUnavailable(`HTTP ${response.status}`);
    },
  };
}

export type ClassifierEvaluation = {
  acerto: number;
  cobertura: number;
  acerto_no_limiar: number;
  minimo: number;
  limiar: number;
  exemplos_teste: number;
};

/** O resultado do eval no conjunto sintético (o mesmo do README), para a tela de Ajustes. */
export async function classifierEvaluation(subject: string): Promise<ClassifierEvaluation | null> {
  const base = env.ML_SERVICE_URL;
  if (!base) return null;
  try {
    const response = await fetch(new URL("/v1/classificador/avaliacao", base), {
      headers: { authorization: `Bearer ${await tokenFor(subject)}` },
      signal: AbortSignal.timeout(SUGGEST_TIMEOUT_MS),
      cache: "no-store",
    });
    return response.ok ? ((await response.json()) as ClassifierEvaluation) : null;
  } catch {
    return null;
  }
}

/** As camadas de fora do banco para a cascata, em nome de quem chama (CascadeServices). */
export function cascadeServices(subject: string) {
  return { classifier: classifierPort(subject) };
}
