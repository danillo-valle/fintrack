// O bot do WhatsApp contra o Postgres (M11, ADR-018): o vínculo por código, a mensagem que
// chega uma vez só (wamid), o número desconhecido que não grava nada, o rascunho, o Confirmar
// que lança uma vez só, a compra parcelada, o Desfazer, o interruptor, a conta das respostas
// grátis (nunca passa de 900, nem com várias filas ao mesmo tempo) e as regras da migração.
//
// Todos os números de telefone são inventados (+55 41 90000-00xx). Rode com: pnpm test:integration
import { randomBytes, randomUUID } from "node:crypto";
import { BOT_STOP_AT, BOT_WARN_AT, encodeAction, type BotReplyKind } from "@fintrack/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorizeHousehold } from "../access";
import {
  botPhoneKey,
  cancelDraft,
  confirmDraft,
  createLinkCode,
  linkCodeStatus,
  openDrafts,
  phoneHash,
  processBotMessage,
  purgeBotMessages,
  recordIncoming,
  reserveReply,
  saveBotPreference,
  setBotEnabled,
  unlinkBot,
  type BotDeps,
  type IncomingBotMessage,
} from "../bot";
import { parseKeyring } from "../connection-secret";
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

// O relógio comum dos testes do bot: todas as mensagens nascem nesta hora, e a limpeza de 90
// dias (global) só alcança as linhas que o próprio teste dela cria em julho
const BOT_CLOCK = new Date("2026-10-21T15:00:00.000Z");
const TODAY = "2026-10-21";
const minutes = (m: number) => new Date(BOT_CLOCK.getTime() + m * 60_000);

const deps: BotDeps = {
  phoneKey: botPhoneKey("segredo-sintetico-dos-testes-de-integracao-do-bot"),
  keyring: parseKeyring(`1:${randomBytes(32).toString("base64")}`),
  today: TODAY,
};

let h: TestHousehold;
let cats: Awaited<ReturnType<typeof createTestCategories>>;
let phones: { holder: string; partner: string; stranger: string };
beforeEach(async () => {
  h = await createTestHousehold();
  cats = await createTestCategories(h.householdId);
  // Números inventados e únicos por teste (os testes rodam em paralelo no mesmo banco)
  const n = randomUUID().replace(/\D/g, "").slice(0, 4).padEnd(4, "0");
  phones = { holder: `5541900${n}01`, partner: `5541900${n}02`, stranger: `5541900${n}03` };
});
afterEach(async () => {
  await prisma.botMessage.deleteMany({
    where: {
      phoneHash: { in: Object.values(phones).map((p) => phoneHash(deps.phoneKey, p)) },
    },
  });
  await deleteTestHousehold(h);
});

function text(
  from: string,
  body: string,
  wamid = `wamid.teste.${randomUUID()}`,
): IncomingBotMessage {
  return { wamid, from, kind: "TEXT", sentAt: minutes(-1), text: body };
}
function button(from: string, id: string): IncomingBotMessage {
  return {
    wamid: `wamid.teste.${randomUUID()}`,
    from,
    kind: "BUTTON",
    sentAt: minutes(-1),
    buttonId: id,
  };
}

/** Grava e processa (o que o webhook e a fila fazem). */
async function send(message: IncomingBotMessage, at: Date = BOT_CLOCK) {
  const recorded = await recordIncoming(prisma, deps, message, at);
  if (!recorded.queue) return { recorded, result: null };
  return { recorded, result: await processBotMessage(prisma, deps, recorded.queue, at) };
}

async function grantOf(userId: string) {
  const access = await authorizeHousehold(prisma, userId, "view");
  if (!access.ok) throw new Error("sem lar");
  return access.grant;
}

/** Vincula o número da pessoa pelo caminho de verdade (código na web, mensagem no WhatsApp). */
async function link(userId: string, phone: string) {
  const { code } = await createLinkCode(
    prisma,
    await grantOf(userId),
    deps.keyring,
    TEST_CTX,
    BOT_CLOCK,
  );
  const { result } = await send(text(phone, `vincular ${code.slice(0, 3)} ${code.slice(3)}`));
  expect(result?.outcome).toBe("LINKED");
  return result!;
}

describe("vínculo por código", () => {
  it("o código liga o número à pessoa; só os 4 últimos dígitos e o HMAC ficam", async () => {
    const result = await link(h.holder.id, phones.holder);
    expect(result.replies).toHaveLength(1);
    expect(result.replies[0]?.kind).toBe("LINKED");
    expect(result.replies[0]?.to).toBe(phones.holder);
    const row = await prisma.botLink.findUniqueOrThrow({ where: { userId: h.holder.id } });
    expect(row.phoneLastFour).toBe(phones.holder.slice(-4));
    expect(row.phoneHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(phones.holder);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { householdId: h.householdId, action: "bot.linked" },
    });
    expect(audit.metadata).toMatchObject({ phone: `***${phones.holder.slice(-4)}` });
    expect(JSON.stringify(audit.metadata)).not.toContain(phones.holder);
  });

  it("código usado, vencido ou errado: silêncio, nada vinculado", async () => {
    const grant = await grantOf(h.holder.id);
    const { code } = await createLinkCode(prisma, grant, deps.keyring, TEST_CTX, BOT_CLOCK);
    const spaced = `vincular ${code.slice(0, 3)} ${code.slice(3)}`;
    // Vencido (11 minutos depois)
    const late = await send(text(phones.holder, spaced), minutes(11));
    expect(late.result?.outcome).toBe("BAD_CODE");
    expect(late.result?.replies).toEqual([]);
    // Usado: o primeiro vincula, o segundo (de outro número) não
    const fresh = await createLinkCode(prisma, grant, deps.keyring, TEST_CTX, BOT_CLOCK);
    const freshText = `vincular ${fresh.code.slice(0, 3)} ${fresh.code.slice(3)}`;
    expect((await send(text(phones.holder, freshText))).result?.outcome).toBe("LINKED");
    const again = await send(text(phones.stranger, freshText));
    expect(again.result?.outcome).toBe("BAD_CODE");
    expect(await prisma.botLink.count({ where: { householdId: h.householdId } })).toBe(1);
  });

  it("a tela do código: esperando (com o código), vinculado, vencido; só da própria pessoa", async () => {
    const grant = await grantOf(h.holder.id);
    const created = await createLinkCode(prisma, grant, deps.keyring, TEST_CTX, BOT_CLOCK);
    expect(await linkCodeStatus(prisma, h.holder.id, created.id, deps.keyring, minutes(1))).toEqual(
      {
        state: "WAITING",
        code: created.code,
        expiresAt: created.expiresAt,
      },
    );
    expect(
      await linkCodeStatus(prisma, h.partner.id, created.id, deps.keyring, minutes(1)),
    ).toEqual({
      state: "EXPIRED",
    });
    expect(
      await linkCodeStatus(prisma, h.holder.id, created.id, deps.keyring, minutes(10)),
    ).toEqual({
      state: "EXPIRED",
    });
    await send(text(phones.holder, `vincular ${created.code}`), minutes(2));
    expect(await linkCodeStatus(prisma, h.holder.id, created.id, deps.keyring, minutes(3))).toEqual(
      {
        state: "LINKED",
        channel: "WHATSAPP",
        lastFour: phones.holder.slice(-4),
      },
    );
    const used = await prisma.botLinkCode.findUniqueOrThrow({ where: { id: created.id } });
    expect(used.codeSealed).toBeNull();
  });

  it("gerar outro código invalida o anterior", async () => {
    const grant = await grantOf(h.holder.id);
    const first = await createLinkCode(prisma, grant, deps.keyring, TEST_CTX, BOT_CLOCK);
    await createLinkCode(prisma, grant, deps.keyring, TEST_CTX, BOT_CLOCK);
    const { result } = await send(text(phones.holder, `vincular ${first.code}`));
    expect(result?.outcome).toBe("BAD_CODE");
  });

  it("cinco códigos errados numa hora: o número é ignorado, mesmo com o código certo", async () => {
    for (let i = 0; i < 5; i++) await send(text(phones.stranger, "vincular 000 000"), minutes(i));
    const { code } = await createLinkCode(
      prisma,
      await grantOf(h.holder.id),
      deps.keyring,
      TEST_CTX,
      minutes(6),
    );
    const { result } = await send(text(phones.stranger, `vincular ${code}`), minutes(6));
    expect(result?.outcome).toBe("BAD_CODE");
    expect(await prisma.botLink.count({ where: { householdId: h.householdId } })).toBe(0);
  });

  it("o mesmo número vinculado por outra pessoa troca de dono; desvincular apaga", async () => {
    await link(h.holder.id, phones.holder);
    await link(h.partner.id, phones.holder);
    expect(await prisma.botLink.findUnique({ where: { userId: h.holder.id } })).toBeNull();
    expect(await prisma.botLink.findUnique({ where: { userId: h.partner.id } })).not.toBeNull();
    expect(await unlinkBot(prisma, await grantOf(h.partner.id), TEST_CTX)).toBe(true);
    expect(await prisma.botLink.count({ where: { householdId: h.householdId } })).toBe(0);
    expect(await auditActions(h.householdId)).toContain("bot.unlinked");
  });

  it("sair do lar apaga o vínculo (chave composta com household_member)", async () => {
    await link(h.partner.id, phones.partner);
    await prisma.householdMember.delete({
      where: { householdId_userId: { householdId: h.householdId, userId: h.partner.id } },
    });
    expect(await prisma.botLink.count({ where: { userId: h.partner.id } })).toBe(0);
  });
});

describe("a mensagem chega uma vez só", () => {
  it("número desconhecido: nada na fila, nenhum texto, nenhuma pessoa", async () => {
    const message = text(phones.stranger, "gastei 50 no posto");
    const recorded = await recordIncoming(prisma, deps, message, BOT_CLOCK);
    expect(recorded).toEqual({ queue: null, duplicate: false });
    const row = await prisma.botMessage.findUniqueOrThrow({ where: { wamid: message.wamid } });
    expect(row).toMatchObject({
      outcome: "UNKNOWN_NUMBER",
      bodyCiphertext: null,
      userId: null,
      householdId: null,
    });
    expect(await prisma.botDraft.count({ where: { householdId: h.householdId } })).toBe(0);
  });

  it("o mesmo wamid entregue de novo não entra outra vez; a fila não lê duas vezes", async () => {
    await link(h.holder.id, phones.holder);
    const message = text(phones.holder, "gastei 42,90 no mercado");
    const first = await recordIncoming(prisma, deps, message, BOT_CLOCK);
    const second = await recordIncoming(prisma, deps, message, BOT_CLOCK);
    expect(first.queue).not.toBeNull();
    expect(second).toEqual({ queue: null, duplicate: true });
    const [a, b] = await Promise.all([
      processBotMessage(prisma, deps, first.queue!, BOT_CLOCK),
      processBotMessage(prisma, deps, first.queue!, BOT_CLOCK),
    ]);
    // As duas filas leram ao mesmo tempo: uma ganha a marcação; o rascunho pode até nascer
    // duas vezes, mas só uma resposta sai e a mensagem fica lida uma vez
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await processBotMessage(prisma, deps, first.queue!, BOT_CLOCK)).toBeNull();
    const row = await prisma.botMessage.findUniqueOrThrow({ where: { id: first.queue! } });
    expect(row.bodyCiphertext).toBeNull();
    expect(row.processedAt).not.toBeNull();
  });
});

describe("do texto ao lançamento", () => {
  beforeEach(async () => {
    await link(h.holder.id, phones.holder);
    await saveBotPreference(prisma, await grantOf(h.holder.id), {
      walletId: h.home.id,
      debitAccountId: h.checking.id,
      creditCardId: h.holderCard.id,
    });
    // A cascata de sempre: a regra "mercado" → Mercado
    await prisma.categoryRule.create({
      data: {
        householdId: h.householdId,
        categoryId: cats.mercado.id,
        pattern: "mercado",
        match: "CONTAINS",
      },
    });
  });

  it("propõe; nada é lançado antes do Confirmar; Confirmar lança UMA vez, origem BOT", async () => {
    const { result } = await send(text(phones.holder, "gastei 42,90 no mercado"));
    expect(result?.outcome).toBe("PROPOSED");
    const proposal = result!.replies[0]!;
    expect(proposal.kind).toBe("PROPOSAL");
    expect(proposal.message.body).toBe(
      "R$ 42,90 · Mercado\nHoje, 21/10 · crédito, Físico\nAmbiente: Casa",
    );
    // Nada nas somas: nenhum lançamento ainda
    expect(await prisma.transaction.count({ where: { householdId: h.householdId } })).toBe(0);
    const draft = await prisma.botDraft.findFirstOrThrow({ where: { householdId: h.householdId } });
    expect((await openDrafts(prisma, h.holder.id, BOT_CLOCK)).map((d) => d.id)).toEqual([draft.id]);

    const confirmId = proposal.message.buttons![0]!.id;
    const [one, two] = await Promise.all([
      send(button(phones.holder, confirmId), minutes(1)),
      send(button(phones.holder, confirmId), minutes(1)),
    ]);
    const outcomes = [one.result?.outcome, two.result?.outcome].sort();
    expect(outcomes).toEqual(["CONFIRMED", "STALE"]);
    const rows = await prisma.transaction.findMany({ where: { householdId: h.householdId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "BOT",
      externalId: draft.id,
      status: "CONFIRMED",
      walletId: h.home.id,
      accountId: h.card.id,
      cardId: h.holderCard.id,
      method: "CREDIT",
      categoryId: cats.mercado.id,
      categorizedBy: "RULE",
      createdById: h.holder.id,
    });
    expect(rows[0]!.amount.toString()).toBe("-42.9");
    expect(await auditActions(h.householdId)).toContain("bot.entry_confirmed");
  });

  it("compra parcelada: o grupo com as faturas, cada parcela com o id da origem", async () => {
    const { result } = await send(text(phones.holder, "tênis 600 em 3x"));
    expect(result!.replies[0]!.message.body.split("\n")[0]).toBe(
      "R$ 600,00 em 3x de R$ 200,00 · Tênis",
    );
    const draft = await prisma.botDraft.findFirstOrThrow({ where: { householdId: h.householdId } });
    const confirmed = await send(
      button(phones.holder, encodeAction({ kind: "CONFIRM", draftId: draft.id })),
    );
    expect(confirmed.result?.outcome).toBe("CONFIRMED");
    const parcels = await prisma.transaction.findMany({
      where: { householdId: h.householdId },
      orderBy: { installmentNumber: "asc" },
    });
    expect(parcels.map((p) => p.externalId)).toEqual([1, 2, 3].map((n) => `${draft.id}:${n}`));
    expect(parcels.every((p) => p.source === "BOT" && p.installmentGroupId !== null)).toBe(true);
  });

  it("Desfazer em 30 minutos exclui o lançamento; depois disso, não", async () => {
    const { result } = await send(text(phones.holder, "padaria 12,40 no pix"));
    const draftId = (
      await prisma.botDraft.findFirstOrThrow({ where: { householdId: h.householdId } })
    ).id;
    expect(result!.replies[0]!.message.body).toContain("pix, Conta");
    await send(button(phones.holder, encodeAction({ kind: "CONFIRM", draftId })), minutes(1));
    const late = await send(
      button(phones.holder, encodeAction({ kind: "UNDO", draftId })),
      minutes(40),
    );
    expect(late.result?.outcome).toBe("STALE");
    expect(
      await prisma.transaction.count({ where: { householdId: h.householdId, deletedAt: null } }),
    ).toBe(1);

    const other = await send(text(phones.holder, "padaria 8 no pix"), minutes(41));
    const otherId = other.result!.replies[0]!.message.buttons![0]!.id.slice(2);
    await send(button(phones.holder, `c:${otherId}`), minutes(42));
    const undo = await send(button(phones.holder, `u:${otherId}`), minutes(50));
    expect(undo.result?.outcome).toBe("UNDONE");
    expect(undo.result?.financeChangedFor).toBe(h.householdId);
    expect(
      await prisma.transaction.count({ where: { householdId: h.householdId, deletedAt: null } }),
    ).toBe(1);
    expect(await auditActions(h.householdId)).toContain("bot.entry_undone");
  });

  it("cancelar não lança nada; o botão de outra pessoa é ignorado em silêncio", async () => {
    await send(text(phones.holder, "gastei 42,90 no mercado"));
    const draft = await prisma.botDraft.findFirstOrThrow({ where: { householdId: h.householdId } });
    await link(h.partner.id, phones.partner);
    const intruder = await send(
      button(phones.partner, encodeAction({ kind: "CONFIRM", draftId: draft.id })),
    );
    expect(intruder.result).toMatchObject({ outcome: "STALE", replies: [] });
    expect(await cancelDraft(prisma, h.partner.id, draft.id, BOT_CLOCK)).toBe(false);
    const cancel = await send(
      button(phones.holder, encodeAction({ kind: "CANCEL", draftId: draft.id })),
    );
    expect(cancel.result?.outcome).toBe("CANCELLED");
    expect(await prisma.transaction.count({ where: { householdId: h.householdId } })).toBe(0);
  });

  it("depois de 24 h o botão não confirma (a proposta fica em Recebidos); a web confirma", async () => {
    await send(text(phones.holder, "gastei 42,90 no mercado"));
    const draft = await prisma.botDraft.findFirstOrThrow({ where: { householdId: h.householdId } });
    const late = await send(
      button(phones.holder, encodeAction({ kind: "CONFIRM", draftId: draft.id })),
      minutes(25 * 60),
    );
    expect(late.result?.outcome).toBe("STALE");
    expect(late.result?.replies[0]?.kind).toBe("EXPIRED");
    const web = await confirmDraft(
      prisma,
      h.holder.id,
      draft.id,
      TEST_CTX,
      undefined,
      minutes(25 * 60),
      TODAY,
    );
    expect(web.ok).toBe(true);
    expect(await prisma.transaction.count({ where: { householdId: h.householdId } })).toBe(1);
  });

  it("número de cartão: recusado, nada guardado (nem rascunho, nem texto)", async () => {
    const digits = "5".padEnd(16, "1");
    const { result, recorded } = await send(text(phones.holder, `${digits} compra 99`));
    expect(result?.outcome).toBe("CARD_NUMBER");
    expect(result?.replies[0]?.message.body).not.toContain(digits.slice(-4));
    const row = await prisma.botMessage.findUniqueOrThrow({ where: { id: recorded.queue! } });
    expect(row.bodyCiphertext).toBeNull();
    expect(await prisma.botDraft.count({ where: { householdId: h.householdId } })).toBe(0);
  });

  it("só o nome de um ambiente no lugar da descrição: diz o que entendeu, nada guardado (M12.0)", async () => {
    const { result } = await send(text(phones.holder, "gastei 1 na casa"));
    expect(result?.outcome).toBe("NOT_UNDERSTOOD");
    expect(result?.replies[0]?.message.body).toMatch(/^Entendi o ambiente “Casa”, mas faltou/);
    expect(await prisma.botDraft.count({ where: { householdId: h.householdId } })).toBe(0);
  });

  it("o bot só lança onde a pessoa pode: a parceira não alcança o ambiente pessoal da titular", async () => {
    await link(h.partner.id, phones.partner);
    // "na Titular" não é um ambiente dela: vira descrição, e o ambiente é o que ela edita
    const { result } = await send(text(phones.partner, "almoço 38 no adicional na Titular"));
    expect(result?.outcome).toBe("ASKED"); // Parceira ou Casa? ela escolhe
    const buttons = result!.replies[0]!.message.buttons!.map((b) => b.title).sort();
    expect(buttons).toEqual(["Casa", "Parceira"]);
    const draft = await prisma.botDraft.findFirstOrThrow({ where: { userId: h.partner.id } });
    expect(draft.walletId).toBeNull();
    expect(draft.cardId).toBe(h.additionalCard.id);
  });

  it("bot desligado no lar: não lê, não responde", async () => {
    const manage = await authorizeHousehold(prisma, h.holder.id, "manage_bot");
    if (!manage.ok) throw new Error("sem crachá");
    await setBotEnabled(prisma, manage.grant, false, TEST_CTX, BOT_CLOCK);
    const { result } = await send(text(phones.holder, "gastei 42,90 no mercado"));
    expect(result).toMatchObject({ outcome: "BOT_OFF", replies: [] });
    expect(await auditActions(h.householdId)).toContain("bot.disabled");
  });

  it("desvinculado enquanto a mensagem esperava na fila: tratada como número desconhecido", async () => {
    const recorded = await recordIncoming(
      prisma,
      deps,
      text(phones.holder, "padaria 5"),
      BOT_CLOCK,
    );
    await unlinkBot(prisma, await grantOf(h.holder.id), TEST_CTX);
    const result = await processBotMessage(prisma, deps, recorded.queue!, BOT_CLOCK);
    expect(result).toMatchObject({ outcome: "UNKNOWN_NUMBER", replies: [] });
  });

  it("padrão que não é da pessoa é recusado", async () => {
    await expect(
      saveBotPreference(prisma, await grantOf(h.partner.id), {
        walletId: h.holderWallet.id,
        debitAccountId: null,
        creditCardId: null,
      }),
    ).rejects.toThrow("NOT_FOUND");
  });
});

describe("respostas grátis do mês", () => {
  const number = () => `teste-${randomUUID()}`;

  it("não-essencial para em 850, essencial em 900; o aviso sai uma vez", async () => {
    const id = number();
    await prisma.botReplyCount.create({
      data: { phoneNumberId: id, month: "2026-10", used: BOT_WARN_AT - 1, updatedAt: BOT_CLOCK },
    });
    const first = await reserveReply(prisma, id, "CONFIRMED", BOT_CLOCK);
    expect(first).toEqual({ allowed: true, warn: true }); // 849 → 850, e o aviso → 851
    expect(await reserveReply(prisma, id, "CONFIRMED", BOT_CLOCK)).toEqual({
      allowed: false,
      warn: false,
    });
    expect(await reserveReply(prisma, id, "PROPOSAL", BOT_CLOCK)).toEqual({
      allowed: true,
      warn: false,
    });
    const row = await prisma.botReplyCount.findUniqueOrThrow({
      where: { phoneNumberId_month: { phoneNumberId: id, month: "2026-10" } },
    });
    expect(row.used).toBe(852);
  });

  it("várias filas ao mesmo tempo nunca passam de 900", async () => {
    const id = number();
    await prisma.botReplyCount.create({
      data: {
        phoneNumberId: id,
        month: "2026-10",
        used: BOT_STOP_AT - 20,
        warnedAt: BOT_CLOCK,
        updatedAt: BOT_CLOCK,
      },
    });
    const kinds: BotReplyKind[] = ["PROPOSAL", "ASK", "LINKED"];
    const results = await Promise.all(
      Array.from({ length: 60 }, (_, i) => reserveReply(prisma, id, kinds[i % 3]!, BOT_CLOCK)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(20);
    const row = await prisma.botReplyCount.findUniqueOrThrow({
      where: { phoneNumberId_month: { phoneNumberId: id, month: "2026-10" } },
    });
    expect(row.used).toBe(BOT_STOP_AT);
  });

  it("o mês vira em São Paulo: 31/10 23:30 ainda conta em outubro", async () => {
    const id = number();
    await reserveReply(prisma, id, "PROPOSAL", new Date("2026-11-01T02:30:00Z"));
    await reserveReply(prisma, id, "PROPOSAL", new Date("2026-11-01T03:30:00Z"));
    const rows = await prisma.botReplyCount.findMany({
      where: { phoneNumberId: id },
      orderBy: { month: "asc" },
    });
    expect(rows.map((r) => [r.month, r.used])).toEqual([
      ["2026-10", 1],
      ["2026-11", 1],
    ]);
    await prisma.botReplyCount.deleteMany({ where: { phoneNumberId: id } });
  });
});

describe("regras da migração", () => {
  it("o número nunca entra: só HMAC e 4 dígitos", async () => {
    const error = await dbError(
      prisma.botLink.create({
        data: {
          userId: h.holder.id,
          householdId: h.householdId,
          // O número em claro (o que um descuido gravaria) não passa no formato do HMAC
          phoneHash: phones.holder,
          phoneLastFour: "0001",
        },
      }),
    );
    expect(error).toContain("bot_link_phone_check");
  });

  it("mensagem lida não guarda texto; na fila não tem resultado", async () => {
    const base = {
      phoneHash: "a".repeat(64),
      kind: "TEXT" as const,
      sentAt: BOT_CLOCK,
    };
    expect(
      await dbError(
        prisma.botMessage.create({
          data: {
            ...base,
            wamid: `wamid.${randomUUID()}`,
            processedAt: BOT_CLOCK,
            outcome: "PROPOSED",
            bodyCiphertext: new Uint8Array([1]),
          },
        }),
      ),
    ).toContain("bot_message_check");
    expect(
      await dbError(
        prisma.botMessage.create({
          data: { ...base, wamid: `wamid.${randomUUID()}`, outcome: "PROPOSED" },
        }),
      ),
    ).toContain("bot_message_check");
  });

  it("rascunho: só despesa positiva, parcelas só no crédito, decisão com data", async () => {
    const base = {
      householdId: h.householdId,
      userId: h.holder.id,
      method: "CREDIT" as const,
      amount: "10.00",
      description: "Teste",
      occurredOn: new Date(`${TODAY}T00:00:00Z`),
    };
    expect(
      await dbError(prisma.botDraft.create({ data: { ...base, amount: "-10.00" } })),
    ).toContain("bot_draft_values_check");
    expect(
      await dbError(
        prisma.botDraft.create({ data: { ...base, method: "PIX", installmentCount: 3 } }),
      ),
    ).toContain("bot_draft_values_check");
    expect(
      await dbError(prisma.botDraft.create({ data: { ...base, method: "BOLETO" } })),
    ).toContain("bot_draft_values_check");
    expect(
      await dbError(prisma.botDraft.create({ data: { ...base, decidedAt: BOT_CLOCK } })),
    ).toContain("bot_draft_status_check");
    expect(
      await dbError(
        prisma.botDraft.create({ data: { ...base, status: "CONFIRMED", decidedAt: BOT_CLOCK } }),
      ),
    ).toContain("bot_draft_status_check");
  });

  it("a conta do mês não passa de 1000 nem aceita mês torto", async () => {
    const id = number2();
    expect(
      await dbError(
        prisma.botReplyCount.create({
          data: { phoneNumberId: id, month: "2026-13", updatedAt: BOT_CLOCK },
        }),
      ),
    ).toContain("bot_reply_count_check");
    expect(
      await dbError(
        prisma.botReplyCount.create({
          data: { phoneNumberId: id, month: "2026-10", used: 1001, updatedAt: BOT_CLOCK },
        }),
      ),
    ).toContain("bot_reply_count_check");
  });
});

const number2 = () => `teste-${randomUUID()}`;

describe("limpeza de 90 dias", () => {
  it("apaga só as mensagens antigas", async () => {
    const old = await prisma.botMessage.create({
      data: {
        wamid: `wamid.antiga.${randomUUID()}`,
        phoneHash: phoneHash(deps.phoneKey, phones.stranger),
        kind: "TEXT",
        sentAt: new Date("2026-07-01T12:00:00Z"),
        createdAt: new Date("2026-07-01T12:00:00Z"),
        processedAt: new Date("2026-07-01T12:00:00Z"),
        outcome: "UNKNOWN_NUMBER",
      },
    });
    const recent = await recordIncoming(prisma, deps, text(phones.stranger, "oi"), BOT_CLOCK);
    expect(recent.duplicate).toBe(false);
    await purgeBotMessages(prisma, BOT_CLOCK);
    expect(await prisma.botMessage.findUnique({ where: { id: old.id } })).toBeNull();
    expect(
      await prisma.botMessage.count({
        where: { phoneHash: phoneHash(deps.phoneKey, phones.stranger) },
      }),
    ).toBe(1);
  });
});
