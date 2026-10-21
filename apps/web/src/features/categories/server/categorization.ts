// Ajustes › Categorização (M10.1, pranchas F-Inteligencia e F-CelInteligencia): quem categorizou
// os lançamentos dos últimos 30 dias, por camada, e o estado do classificador. Tudo pelas
// carteiras que a pessoa VÊ: a medida da outra pessoa (a carteira pessoal dela) não entra.
// M10.2b: o cartão da IA local (ligada desde quando, a fila e a última noite).
import "server-only";
import { canInHousehold } from "@fintrack/core";
import {
  categorizationStats,
  classifierSummary,
  localAiSummary,
  prisma,
  statsPeriod,
} from "@fintrack/db";
import { AccessError, requireHouseholdAccess, requireScope } from "@/lib/access";
import type { Session } from "@/lib/auth";
import { env } from "@/lib/env";
import { classifierEvaluation } from "@/lib/ml/classifier";

export async function getCategorizationPage(session: Session) {
  let canManage = false;
  try {
    const grant = await requireHouseholdAccess(session, "view");
    canManage = canInHousehold(grant.role, "manage_categories");
  } catch (error) {
    if (error instanceof AccessError && error.reason === "NO_HOUSEHOLD") return null;
    throw error;
  }
  const scope = await requireScope(session, "view");
  const period = statsPeriod();
  const [stats, classifier, evaluation, localAi] = await Promise.all([
    categorizationStats(prisma, scope, period),
    classifierSummary(prisma, scope),
    classifierEvaluation(session.user.id),
    localAiSummary(prisma, scope),
  ]);
  return {
    period,
    stats,
    classifier,
    evaluation,
    localAi: localAi ?? { enabledAt: null, queued: 0, lastNight: null },
    configured: Boolean(env.ML_SERVICE_URL),
    canManage,
  };
}

export type CategorizationPage = NonNullable<Awaited<ReturnType<typeof getCategorizationPage>>>;
