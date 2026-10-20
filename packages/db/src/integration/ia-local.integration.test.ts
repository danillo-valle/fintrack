// A IA local contra o Postgres (M10.2b, ADR-016): a fila (uma consulta), a noite com uma porta
// de mentira no lugar do serviço Python, o teto, o interruptor, a medida, o "Criar e aplicar" da
// categoria nova, a revisão e o "Por que", e as regras coladas na migração.
//
// Rode com: pnpm test:integration
import {
  LOCAL_AI_NIGHT_LIMIT,
  LocalAiUnavailable,
  type LocalAiAnswer,
  type LocalAiPort,
  type LocalAiQuestion,
} from "@fintrack/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorizeHousehold, authorizeScope } from "../access";
import { explainTransaction, votingWhere } from "../categories";
import {
  applyLocalAiProposal,
  localAiProposalPreview,
  localAiQueueWhere,
  localAiSummary,
  runLocalAiNight,
  setLocalAi,
} from "../local-ai";
import { confirmBulk, reviewQueue } from "../review";
import {
  auditActions,
  createTestCategories,
  createTestHousehold,
  dbError,
  deleteTestHousehold,
  prisma,
  TEST_CTX,
  type TestHousehold,
} from "./fixtures";

let h: TestHousehold;
let cats: Awaited<ReturnType<typeof createTestCategories>>;
let alimentacao: { id: string };
let saude: { id: string };
beforeEach(async () => {
  h = await createTestHousehold();
  cats = await createTestCategories(h.householdId);
  // Uma árvore pequena: Alimentação (mãe) › Mercado; Saúde (mãe, sem filhas)
  alimentacao = await prisma.category.create({
    data: { householdId: h.householdId, name: "Alimentação", kind: "EXPENSE" },
  });
  saude = await prisma.category.create({
    data: { householdId: h.householdId, name: "Saúde", kind: "EXPENSE" },
  });
  await prisma.category.update({
    where: { id: cats.mercado.id },
    data: { parentId: alimentacao.id },
  });
});
afterEach(async () => {
  await deleteTestHousehold(h);
});

let seq = 0;
/** Um recebido de uma carga do banco (OFX), pendente e sem categoria. */
async function received(
  description: string,
  options: {
    amount?: string;
    walletId?: string;
    accountId?: string;
    source?: "OFX" | "OPEN_FINANCE" | "PDF" | "MANUAL";
    status?: "PENDING" | "CONFIRMED";
    categoryId?: string | null;
  } = {},
) {
  seq += 1;
  const source = options.source ?? "OFX";
  return prisma.transaction.create({
    data: {
      householdId: h.householdId,
      walletId: options.walletId ?? h.home.id,
      accountId: options.accountId ?? h.checking.id,
      // O vale da parceira só aceita "vale" (transaction_method_matches_account)
      method: options.accountId === h.voucher.id ? "VOUCHER" : "PIX",
      amount: options.amount ?? "-10",
      occurredOn: new Date("2026-10-16T00:00:00Z"),
      description,
      status: options.status ?? "PENDING",
      source,
      externalId: source === "MANUAL" ? null : `ia-${h.tag}-${seq}`,
      categoryId: options.categoryId ?? null,
    },
  });
}

async function turnOn() {
  const grant = await authorizeHousehold(prisma, h.holder.id, "manage_categories");
  if (!grant.ok) throw new Error("crachá");
  await setLocalAi(prisma, grant.grant, true, TEST_CTX);
  return grant.grant;
}

/** A IA de mentira: responde pelo texto; guarda o que perguntaram. */
function fakeAi(answers: Record<string, LocalAiAnswer>, options: { readyOk?: boolean } = {}) {
  const asked: LocalAiQuestion[] = [];
  const port: LocalAiPort = {
    async ready() {
      return options.readyOk ?? true;
    },
    async suggest(question) {
      asked.push(question);
      const answer = answers[question.description];
      if (!answer) throw new LocalAiUnavailable();
      return answer;
    },
  };
  return { port, asked };
}

const attemptOf = (id: string) =>
  prisma.localAiAttempt.findUnique({ where: { transactionId: id } });
const tx = (id: string) => prisma.transaction.findUniqueOrThrow({ where: { id } });

describe("as regras coladas na migração", () => {
  it("proposta de categoria nova só num NEW_CATEGORY, e todo NEW_CATEGORY tem nome", async () => {
    const t = await received("X");
    const base = { transactionId: t.id, householdId: h.householdId };
    expect(
      await dbError(prisma.localAiAttempt.create({ data: { ...base, outcome: "NEW_CATEGORY" } })),
    ).toContain("local_ai_attempt_proposal_check");
    expect(
      await dbError(
        prisma.localAiAttempt.create({
          data: { ...base, outcome: "SUGGESTED", proposedName: "Academia" },
        }),
      ),
    ).toContain("local_ai_attempt_proposal_check");
    expect(
      await dbError(
        prisma.localAiAttempt.create({
          data: { ...base, outcome: "NO_SUGGESTION", proposedParentId: saude.id },
        }),
      ),
    ).toContain("local_ai_attempt_proposal_check");
  });

  it.each(["Ligue 0800", "Um dois tres quatro", "Aaaaaaaaaaaaaaa Bbbbbbbbbbbbbbb", "a"])(
    "nome proposto fora do padrão (%s) é recusado pelo banco",
    async (nome) => {
      const t = await received("X");
      const error = await dbError(
        prisma.localAiAttempt.create({
          data: {
            transactionId: t.id,
            householdId: h.householdId,
            outcome: "NEW_CATEGORY",
            proposedName: nome,
          },
        }),
      );
      expect(error).toContain("local_ai_attempt_proposed_name_check");
    },
  );

  it("um recebido é visto uma vez só", async () => {
    const t = await received("X");
    const data = { transactionId: t.id, householdId: h.householdId, outcome: "BLOCKED" as const };
    await prisma.localAiAttempt.create({ data });
    expect(await dbError(prisma.localAiAttempt.create({ data }))).toContain(
      "local_ai_attempt_pkey",
    );
  });
});

describe("a fila", () => {
  it("só recebido de carga, pendente, sem categoria, sem transferência e ainda não visto", async () => {
    const entra = await received("QUITANDA");
    const pdf = await received("BOTICA", { source: "PDF" });
    const pluggy = await received("PAG*X", { source: "OPEN_FINANCE" });
    await received("MANUAL PENDENTE", { source: "MANUAL" });
    await received("JA CONFIRMADO", { status: "CONFIRMED" });
    await received("COM CATEGORIA", { categoryId: cats.padaria.id });
    const visto = await received("VISTO");
    await prisma.localAiAttempt.create({
      data: { transactionId: visto.id, householdId: h.householdId, outcome: "NO_SUGGESTION" },
    });
    const ids = await prisma.transaction.findMany({
      where: localAiQueueWhere(h.householdId),
      select: { id: true },
    });
    expect(ids.map((r) => r.id).sort()).toEqual([entra.id, pdf.id, pluggy.id].sort());
  });

  it("IA desligada no lar: a noite não pergunta nada", async () => {
    await received("QUITANDA");
    const ai = fakeAi({});
    const night = await runLocalAiNight(prisma, ai.port);
    expect(night).toMatchObject({ status: "DONE", households: 0, asked: 0 });
    expect(ai.asked).toEqual([]);
  });

  it("IA fora do ar (fora da janela): nada é perguntado nem gravado", async () => {
    await turnOn();
    const t = await received("QUITANDA");
    const ai = fakeAi({}, { readyOk: false });
    expect((await runLocalAiNight(prisma, ai.port)).status).toBe("UNAVAILABLE");
    expect(await attemptOf(t.id)).toBeNull();
  });
});

describe("a noite", () => {
  it("grava a categoria sugerida, que continua pendente e não vota enquanto ninguém confirmar", async () => {
    await turnOn();
    const t = await received("QUITANDA DO SEU JOAO");
    const ai = fakeAi({ "QUITANDA DO SEU JOAO": { outcome: "SUGGESTED", category: "Mercado" } });
    const night = await runLocalAiNight(prisma, ai.port);
    expect(night).toMatchObject({ status: "DONE", asked: 1, applied: 1 });
    expect(night.outcomes.SUGGESTED).toBe(1);
    const after = await tx(t.id);
    expect(after).toMatchObject({
      categoryId: cats.mercado.id,
      categorizedBy: "LLM",
      categorizationConfidence: null,
      status: "PENDING",
    });
    expect((await attemptOf(t.id))?.outcome).toBe("SUGGESTED");
    // A IA recebeu só os nomes do tipo certo (despesa) e as mães de primeiro nível
    expect(ai.asked[0]?.categories).toEqual(
      expect.arrayContaining(["Mercado", "Restaurante", "Padaria", "Alimentação", "Saúde"]),
    );
    expect(ai.asked[0]?.categories).not.toContain("Salário");
    expect(ai.asked[0]?.parents).toEqual(
      expect.arrayContaining(["Alimentação", "Saúde", "Restaurante", "Padaria"]),
    );
    expect(ai.asked[0]?.parents).not.toContain("Mercado");
    // Não vota no histórico nem treina enquanto pendente
    const voters = await prisma.transaction.count({
      where: { ...votingWhere([h.home.id]), id: t.id },
    });
    expect(voters).toBe(0);
  });

  it("nenhuma, barrada e inválida saem da fila sem categoria", async () => {
    await turnOn();
    const [a, b, c] = await Promise.all([received("A"), received("B"), received("C")]);
    const ai = fakeAi({
      A: { outcome: "NO_SUGGESTION" },
      B: { outcome: "BLOCKED" },
      C: { outcome: "INVALID" },
    });
    await runLocalAiNight(prisma, ai.port);
    for (const [t, outcome] of [
      [a, "NO_SUGGESTION"],
      [b, "BLOCKED"],
      [c, "INVALID"],
    ] as const) {
      expect((await attemptOf(t.id))?.outcome).toBe(outcome);
      expect((await tx(t.id)).categoryId).toBeNull();
    }
    expect(await prisma.transaction.count({ where: localAiQueueWhere(h.householdId) })).toBe(0);
  });

  it("categoria nova: guarda o nome e a mãe; nome igual a uma existente vira ela", async () => {
    await turnOn();
    const nova = await received("ACADEMIA CORPO FORTE");
    const igual = await received("DROGARIA");
    const outroTipo = await received("CREDITO", { amount: "-5" });
    const ai = fakeAi({
      "ACADEMIA CORPO FORTE": { outcome: "NEW_CATEGORY", name: "Academia", parent: "Saúde" },
      // "padaria" (sem acento, minúscula) = a categoria Padaria que já existe
      DROGARIA: { outcome: "NEW_CATEGORY", name: "padaria", parent: null },
      // "Salário" existe, mas é de receita: o nome está ocupado no lar
      CREDITO: { outcome: "NEW_CATEGORY", name: "Salario", parent: null },
    });
    await runLocalAiNight(prisma, ai.port);
    expect(await attemptOf(nova.id)).toMatchObject({
      outcome: "NEW_CATEGORY",
      proposedName: "Academia",
      proposedParentId: saude.id,
    });
    expect((await tx(nova.id)).categoryId).toBeNull();
    expect(await tx(igual.id)).toMatchObject({ categoryId: cats.padaria.id, categorizedBy: "LLM" });
    expect((await attemptOf(outroTipo.id))?.outcome).toBe("NO_SUGGESTION");
  });

  it("não sobrescreve o que a pessoa decidiu no meio da noite", async () => {
    await turnOn();
    const t = await received("QUITANDA");
    const port: LocalAiPort = {
      ready: async () => true,
      async suggest() {
        // Enquanto a IA pensava, a pessoa escolheu a categoria
        await prisma.transaction.update({
          where: { id: t.id },
          data: { categoryId: cats.padaria.id, categorizedBy: "MANUAL" },
        });
        return { outcome: "SUGGESTED", category: "Mercado" };
      },
    };
    const night = await runLocalAiNight(prisma, port);
    expect(night.applied).toBe(0);
    expect(await tx(t.id)).toMatchObject({ categoryId: cats.padaria.id, categorizedBy: "MANUAL" });
  });

  it("despesas primeiro, depois receitas; para quando a IA sai do ar, sem gravar o que faltou", async () => {
    await turnOn();
    const receita = await received("RECEITA", { amount: "50" });
    const despesa = await received("DESPESA");
    const ai = fakeAi({ DESPESA: { outcome: "NO_SUGGESTION" } }); // RECEITA: fora do ar
    const night = await runLocalAiNight(prisma, ai.port);
    expect(ai.asked.map((q) => q.description)).toEqual(["DESPESA", "RECEITA"]);
    expect(ai.asked[1]?.kind).toBe("income");
    expect(night.status).toBe("UNAVAILABLE");
    expect(await attemptOf(despesa.id)).not.toBeNull();
    expect(await attemptOf(receita.id)).toBeNull();
  });

  it("para no fim da janela (deadline)", async () => {
    await turnOn();
    await received("A");
    await received("B");
    let clock = new Date("2026-10-17T09:30:00Z");
    const deadline = new Date("2026-10-17T09:40:00Z");
    const port: LocalAiPort = {
      ready: async () => true,
      async suggest() {
        clock = new Date(clock.getTime() + 15 * 60 * 1000); // 15 min por item
        return { outcome: "NO_SUGGESTION" };
      },
    };
    const night = await runLocalAiNight(prisma, port, { now: () => clock, deadline });
    expect(night).toMatchObject({ status: "DEADLINE", asked: 1 });
  });

  it(`no máximo ${LOCAL_AI_NIGHT_LIMIT} por lar por noite, contando o que a noite já fez`, async () => {
    await turnOn();
    const now = new Date("2026-10-17T08:00:00Z"); // 05:00 em São Paulo
    // A noite já viu LIMITE - 1 recebidos
    const vistos = await Promise.all(
      Array.from({ length: LOCAL_AI_NIGHT_LIMIT - 1 }, (_, i) => received(`V${i}`)),
    );
    await prisma.localAiAttempt.createMany({
      data: vistos.map((t) => ({
        transactionId: t.id,
        householdId: h.householdId,
        outcome: "NO_SUGGESTION" as const,
        attemptedAt: new Date("2026-10-17T07:50:00Z"),
      })),
    });
    await received("UM");
    await received("DOIS");
    const ai = fakeAi({ UM: { outcome: "NO_SUGGESTION" }, DOIS: { outcome: "NO_SUGGESTION" } });
    const night = await runLocalAiNight(prisma, ai.port, { now: () => now });
    expect(night.asked).toBe(1);
  });
});

describe("o interruptor e a medida", () => {
  it("liga e desliga com auditoria; repetir não muda nada", async () => {
    const grant = await turnOn();
    const at = (await prisma.household.findUniqueOrThrow({ where: { id: h.householdId } }))
      .localAiEnabledAt;
    expect(at).not.toBeNull();
    await setLocalAi(prisma, grant, true, TEST_CTX);
    await setLocalAi(prisma, grant, false, TEST_CTX);
    expect(
      (await prisma.household.findUniqueOrThrow({ where: { id: h.householdId } })).localAiEnabledAt,
    ).toBeNull();
    expect(await auditActions(h.householdId)).toEqual(
      expect.arrayContaining(["local_ai.enabled", "local_ai.disabled"]),
    );
    const enabled = (await auditActions(h.householdId)).filter((a) => a === "local_ai.enabled");
    expect(enabled).toHaveLength(1);
  });

  it("fila e última noite só pelas carteiras que a pessoa vê", async () => {
    await turnOn();
    await received("CASA 1");
    await received("DELA 1", { walletId: h.partnerWallet.id, accountId: h.voucher.id });
    const dela = await received("DELA 2", {
      walletId: h.partnerWallet.id,
      accountId: h.voucher.id,
    });
    await prisma.localAiAttempt.create({
      data: { transactionId: dela.id, householdId: h.householdId, outcome: "BLOCKED" },
    });
    const minha = await localAiSummary(prisma, await authorizeScope(prisma, h.holder.id, "view"));
    expect(minha).toMatchObject({ queued: 1, lastNight: null });
    const dela2 = await localAiSummary(prisma, await authorizeScope(prisma, h.partner.id, "view"));
    expect(dela2?.queued).toBe(2);
    expect(dela2?.lastNight?.outcomes.BLOCKED).toBe(1);
  });
});

describe("criar e aplicar a categoria nova", () => {
  async function proposal(description: string, name: string, walletId = h.home.id) {
    const t = await received(description, {
      walletId,
      accountId: walletId === h.partnerWallet.id ? h.voucher.id : h.checking.id,
    });
    await prisma.localAiAttempt.create({
      data: {
        transactionId: t.id,
        householdId: h.householdId,
        outcome: "NEW_CATEGORY",
        proposedName: name,
        proposedParentId: saude.id,
      },
    });
    return t;
  }

  it("cria na mãe escolhida e aplica aos pendentes com a mesma proposta que a pessoa edita", async () => {
    const grant = await turnOn();
    const a = await proposal("ACADEMIA 1", "Academia");
    const b = await proposal("ACADEMIA 2", "academia");
    const outra = await proposal("PISCINA", "Natação");
    const dela = await proposal("ACADEMIA DELA", "Academia", h.partnerWallet.id);
    const edit = await authorizeScope(prisma, h.holder.id, "edit");
    const result = await applyLocalAiProposal(
      prisma,
      grant,
      edit,
      { transactionId: a.id, name: "Academia", parentId: saude.id },
      TEST_CTX,
    );
    expect(result).toMatchObject({ created: true, applied: 2 });
    const categoria = await prisma.category.findUniqueOrThrow({ where: { id: result.categoryId } });
    expect(categoria).toMatchObject({ name: "Academia", kind: "EXPENSE", parentId: saude.id });
    for (const t of [a, b]) {
      expect(await tx(t.id)).toMatchObject({ categoryId: categoria.id, categorizedBy: "LLM" });
    }
    expect((await tx(outra.id)).categoryId).toBeNull();
    expect((await tx(dela.id)).categoryId).toBeNull(); // carteira pessoal dela: não é minha
    expect(await auditActions(h.householdId)).toEqual(
      expect.arrayContaining(["category.created", "local_ai.proposal_applied"]),
    );
  });

  it("nome trocado pela pessoa: autor MANUAL; nome que já existe: só aplica", async () => {
    const grant = await turnOn();
    const edit = await authorizeScope(prisma, h.holder.id, "edit");
    const a = await proposal("ACADEMIA", "Academia");
    const renamed = await applyLocalAiProposal(
      prisma,
      grant,
      edit,
      { transactionId: a.id, name: "Esporte", parentId: null },
      TEST_CTX,
    );
    expect(await tx(a.id)).toMatchObject({ categorizedBy: "MANUAL" });
    const b = await proposal("ACADEMIA 2", "Ginástica");
    const reused = await applyLocalAiProposal(
      prisma,
      grant,
      edit,
      { transactionId: b.id, name: "esporte", parentId: null },
      TEST_CTX,
    );
    expect(reused).toMatchObject({ created: false, categoryId: renamed.categoryId, applied: 1 });
  });

  it("a prévia: a proposta, as mães do tipo e onde vai entrar, só no que a pessoa edita", async () => {
    await turnOn();
    const edit = await authorizeScope(prisma, h.holder.id, "edit");
    const a = await proposal("ACADEMIA 1", "Academia");
    await proposal("ACADEMIA 2", "ACADEMIA");
    await proposal("PISCINA", "Natação");
    const dela = await proposal("ACADEMIA DELA", "Academia", h.partnerWallet.id);
    const preview = await localAiProposalPreview(prisma, edit, a.id);
    expect(preview).toMatchObject({
      kind: "expense",
      name: "Academia",
      parent: { id: saude.id, name: "Saúde" },
    });
    expect(preview?.parents.map((p) => p.name)).toContain("Saúde");
    expect(preview?.parents.map((p) => p.name)).not.toContain("Mercado"); // filha, não mãe
    expect(preview?.siblings.map((t) => t.description).toSorted()).toEqual([
      "ACADEMIA 1",
      "ACADEMIA 2",
    ]);
    expect(await localAiProposalPreview(prisma, edit, dela.id)).toBeNull();
    expect(await localAiProposalPreview(prisma, edit, "não é id")).toBeNull();
  });

  it("recusa: nome de outro tipo, mãe que não é de 1º nível, recebido já decidido", async () => {
    const grant = await turnOn();
    const edit = await authorizeScope(prisma, h.holder.id, "edit");
    const a = await proposal("X", "Academia");
    const apply = (name: string, parentId: string | null, id = a.id) =>
      applyLocalAiProposal(prisma, grant, edit, { transactionId: id, name, parentId }, TEST_CTX);
    await expect(apply("Salário", null)).rejects.toMatchObject({ code: "CATEGORY_EXISTS" });
    await expect(apply("Academia", cats.mercado.id)).rejects.toMatchObject({
      code: "CATEGORY_INVALID",
    });
    await prisma.transaction.update({ where: { id: a.id }, data: { categoryId: cats.padaria.id } });
    await expect(apply("Academia", null)).rejects.toMatchObject({ code: "REVIEW_STALE" });
  });
});

describe("a revisão e o Por que", () => {
  it("na fila, proposta, e o lote não confirma a categoria da IA", async () => {
    await turnOn();
    const fila = await received("QUITANDA");
    const daIa = await received("DA IA", { categoryId: cats.mercado.id });
    await prisma.transaction.update({ where: { id: daIa.id }, data: { categorizedBy: "LLM" } });
    const daRegra = await received("DA REGRA", { categoryId: cats.padaria.id });
    await prisma.transaction.update({ where: { id: daRegra.id }, data: { categorizedBy: "RULE" } });
    const nova = await received("ACADEMIA");
    await prisma.localAiAttempt.create({
      data: {
        transactionId: nova.id,
        householdId: h.householdId,
        outcome: "NEW_CATEGORY",
        proposedName: "Academia",
        proposedParentId: saude.id,
      },
    });
    const view = await authorizeScope(prisma, h.holder.id, "view");
    const edit = await authorizeScope(prisma, h.holder.id, "edit");
    const queue = await reviewQueue(prisma, view, edit);
    const items = queue.groups.flatMap((g) => g.items);
    const byId = (id: string) => items.find((i) => i.id === id);
    expect(queue).toMatchObject({ localAiOn: true, localAiQueued: 1, confirmable: 1 });
    expect(byId(fila.id)?.localAi).toEqual({ queued: true, proposal: null });
    expect(byId(nova.id)?.localAi).toEqual({
      queued: false,
      proposal: { name: "Academia", parent: { id: saude.id, name: "Saúde" } },
    });
    const { ids } = await confirmBulk(prisma, edit, {}, TEST_CTX);
    expect(ids).toEqual([daRegra.id]);
    expect((await tx(daIa.id)).status).toBe("PENDING");
  });

  it("a 5ª camada do Por que: na fila, desligada, manual, decidida e a proposta", async () => {
    const view = await authorizeScope(prisma, h.holder.id, "view");
    const t = await received("QUITANDA XYZ");
    const manual = await received("MANUAL XYZ", { source: "MANUAL" });
    const local = async (id: string) => (await explainTransaction(prisma, view, id))?.localAi;
    expect((await local(t.id))?.state).toBe("OFF");
    await turnOn();
    expect((await local(t.id))?.state).toBe("QUEUED");
    expect((await local(manual.id))?.state).toBe("NOT_BULK");
    await prisma.localAiAttempt.create({
      data: {
        transactionId: t.id,
        householdId: h.householdId,
        outcome: "NEW_CATEGORY",
        proposedName: "Quitanda",
        proposedParentId: alimentacao.id,
      },
    });
    expect(await local(t.id)).toEqual({
      state: "NEW_CATEGORY",
      proposal: { name: "Quitanda", parent: "Alimentação" },
    });
    await prisma.transaction.update({
      where: { id: t.id },
      data: { categoryId: cats.mercado.id, categorizedBy: "LLM" },
    });
    expect((await local(t.id))?.state).toBe("DECIDED");
  });
});
