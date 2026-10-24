// O Telegram como segundo canal do bot contra o Postgres (M12.0b, ADR-019): o vínculo pelo
// /start com o código, a conta guardada só como HMAC, os dois canais ao mesmo tempo, a frase de
// uso particular para quem não está vinculado, a resposta que troca a mensagem do botão, a
// mensagem com número de cartão que sai da conversa, a recusa da Meta anotada e as regras da
// migração.
//
// Os ids de conversa do Telegram são inventados (9 dígitos começando em 7000). Rode com:
// pnpm test:integration
import { randomBytes, randomUUID } from "node:crypto";
import {
  CARD_NUMBER_REMOVED_MESSAGE,
  encodeAction,
  notUnderstoodMessage,
  PRIVATE_BOT_MESSAGE,
} from "@fintrack/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorizeHousehold } from "../access";
import {
  botPhoneKey,
  botReplyUsage,
  botSettings,
  createLinkCode,
  linkCodeStatus,
  phoneHash,
  processBotMessage,
  recordIncoming,
  recordReplyResult,
  saveBotPreference,
  telegramChatHash,
  unlinkBot,
  type BotDeps,
  type IncomingBotMessage,
} from "../bot";
import { parseKeyring } from "../connection-secret";
import {
  auditActions,
  createTestHousehold,
  dbError,
  deleteTestHousehold,
  prisma,
  TEST_CTX,
  type TestHousehold,
} from "./fixtures";

// O mesmo relógio dos testes do WhatsApp (a limpeza de 90 dias é global)
const BOT_CLOCK = new Date("2026-10-21T15:00:00.000Z");
const minutes = (m: number) => new Date(BOT_CLOCK.getTime() + m * 60_000);

const deps: BotDeps = {
  phoneKey: botPhoneKey("segredo-sintetico-dos-testes-de-integracao-do-bot"),
  keyring: parseKeyring(`1:${randomBytes(32).toString("base64")}`),
  today: "2026-10-21",
};

let h: TestHousehold;
let chats: { holder: string; partner: string; stranger: string };
let phone: string;
beforeEach(async () => {
  h = await createTestHousehold();
  const n = randomUUID().replace(/\D/g, "").slice(0, 4).padEnd(4, "0");
  chats = { holder: `7000${n}1`, partner: `7000${n}2`, stranger: `7000${n}3` };
  phone = `5541900${n}01`;
});
afterEach(async () => {
  await prisma.botMessage.deleteMany({
    where: {
      phoneHash: {
        in: [
          ...Object.values(chats).map((c) => telegramChatHash(deps.phoneKey, c)),
          phoneHash(deps.phoneKey, phone),
        ],
      },
    },
  });
  await deleteTestHousehold(h);
});

let update = 0;
function tgText(chat: string, body: string, messageId = String(++update)): IncomingBotMessage {
  return {
    channel: "TELEGRAM",
    wamid: `tg:${randomUUID()}`,
    from: chat,
    kind: "TEXT",
    sentAt: minutes(-1),
    text: body,
    messageId,
  };
}
function tgButton(chat: string, id: string, buttonMessageId: string): IncomingBotMessage {
  return {
    channel: "TELEGRAM",
    wamid: `tg:${randomUUID()}`,
    from: chat,
    kind: "BUTTON",
    sentAt: minutes(-1),
    buttonId: id,
    callbackId: `cb-${randomUUID()}`,
    buttonMessageId,
  };
}

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

async function linkTelegram(userId: string, chat: string) {
  const created = await createLinkCode(
    prisma,
    await grantOf(userId),
    deps.keyring,
    TEST_CTX,
    BOT_CLOCK,
  );
  const { result } = await send(tgText(chat, `/start ${created.code}`));
  expect(result?.outcome).toBe("LINKED");
  return { created, result: result! };
}

describe("vínculo pelo Telegram", () => {
  it("o /start com o código vincula a conta; só o HMAC fica, nem o id nem o nome", async () => {
    const { created, result } = await linkTelegram(h.holder.id, chats.holder);
    expect(result.channel).toBe("TELEGRAM");
    expect(result.replies).toHaveLength(1);
    expect(result.replies[0]?.to).toBe(chats.holder);
    expect(result.replies[0]?.message.body).toContain("Este Telegram agora lança no FinTrack");
    const row = await prisma.botTelegramLink.findUniqueOrThrow({ where: { userId: h.holder.id } });
    expect(row.chatHash).toBe(telegramChatHash(deps.phoneKey, chats.holder));
    expect(JSON.stringify(row)).not.toContain(chats.holder);
    // O código registra o canal e a tela do código diz que foi o Telegram
    const code = await prisma.botLinkCode.findUniqueOrThrow({ where: { id: created.id } });
    expect(code.usedChannel).toBe("TELEGRAM");
    expect(await linkCodeStatus(prisma, h.holder.id, created.id, deps.keyring, minutes(1))).toEqual(
      { state: "LINKED", channel: "TELEGRAM", lastFour: null },
    );
    // Auditoria só com o canal
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { householdId: h.householdId, action: "bot.linked" },
    });
    expect(audit.metadata).toMatchObject({ channel: "telegram" });
    expect(JSON.stringify(audit.metadata)).not.toContain(chats.holder);
    // A mensagem gravada não guarda nada aberto
    const message = await prisma.botMessage.findFirstOrThrow({
      where: { phoneHash: row.chatHash },
    });
    expect(message).toMatchObject({ channel: "TELEGRAM", bodyCiphertext: null });
    expect(message.wamid.startsWith("tg:")).toBe(true);
  });

  it("o código digitado (vincular 123 456) também vale no Telegram", async () => {
    const created = await createLinkCode(
      prisma,
      await grantOf(h.holder.id),
      deps.keyring,
      TEST_CTX,
      BOT_CLOCK,
    );
    const { result } = await send(
      tgText(chats.holder, `vincular ${created.code.slice(0, 3)} ${created.code.slice(3)}`),
    );
    expect(result?.outcome).toBe("LINKED");
    expect(await prisma.botTelegramLink.count({ where: { userId: h.holder.id } })).toBe(1);
  });

  it("WhatsApp e Telegram ao mesmo tempo; desvincular um deixa o outro", async () => {
    // WhatsApp pelo caminho de verdade
    const wa = await createLinkCode(
      prisma,
      await grantOf(h.holder.id),
      deps.keyring,
      TEST_CTX,
      BOT_CLOCK,
    );
    const waLink = await send({
      wamid: `wamid.teste.${randomUUID()}`,
      from: phone,
      kind: "TEXT",
      sentAt: minutes(-1),
      text: `vincular ${wa.code}`,
    });
    expect(waLink.result?.outcome).toBe("LINKED");
    await linkTelegram(h.holder.id, chats.holder);
    const settings = await botSettings(prisma, await grantOf(h.holder.id), null, BOT_CLOCK);
    expect(settings.link?.phoneLastFour).toBe(phone.slice(-4));
    expect(settings.telegramLink).not.toBeNull();

    expect(await unlinkBot(prisma, await grantOf(h.holder.id), TEST_CTX, "TELEGRAM")).toBe(true);
    expect(await prisma.botTelegramLink.count({ where: { userId: h.holder.id } })).toBe(0);
    expect(await prisma.botLink.count({ where: { userId: h.holder.id } })).toBe(1);
    const unlinked = await prisma.auditLog.findFirstOrThrow({
      where: { householdId: h.householdId, action: "bot.unlinked" },
    });
    expect(unlinked.metadata).toEqual({ channel: "telegram" });
    // Desvinculado: a conta volta a ser desconhecida
    const after = await send(tgText(chats.holder, "gastei 10 no mercado"), minutes(2));
    expect(after.recorded.queue).toBeNull();
  });

  it("a mesma conta do Telegram vinculada por outra pessoa sai da primeira", async () => {
    await linkTelegram(h.holder.id, chats.holder);
    await linkTelegram(h.partner.id, chats.holder);
    expect(await prisma.botTelegramLink.count({ where: { userId: h.holder.id } })).toBe(0);
    expect(await prisma.botTelegramLink.count({ where: { userId: h.partner.id } })).toBe(1);
  });
});

describe("quem não está vinculado no Telegram", () => {
  it("mensagem comum: nenhuma fila, nenhuma resposta, só a linha de contagem", async () => {
    const { recorded } = await send(tgText(chats.stranger, "gastei 50 no posto"));
    expect(recorded.queue).toBeNull();
    const rows = await prisma.botMessage.findMany({
      where: { phoneHash: telegramChatHash(deps.phoneKey, chats.stranger) },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      channel: "TELEGRAM",
      outcome: "UNKNOWN_NUMBER",
      bodyCiphertext: null,
      householdId: null,
    });
  });

  it("/start sem código, com código errado ou vencido: a mesma frase de uso particular", async () => {
    const bare = await send(tgText(chats.stranger, "/start"));
    expect(bare.result?.outcome).toBe("UNKNOWN_NUMBER");
    expect(bare.result?.replies.map((r) => r.message)).toEqual([PRIVATE_BOT_MESSAGE]);
    const wrong = await send(tgText(chats.stranger, "/start 000000"));
    expect(wrong.result?.outcome).toBe("BAD_CODE");
    expect(wrong.result?.replies.map((r) => r.message)).toEqual([PRIVATE_BOT_MESSAGE]);
    const created = await createLinkCode(
      prisma,
      await grantOf(h.holder.id),
      deps.keyring,
      TEST_CTX,
      BOT_CLOCK,
    );
    const late = await send(tgText(chats.stranger, `/start ${created.code}`), minutes(11));
    expect(late.result?.outcome).toBe("BAD_CODE");
    expect(late.result?.replies.map((r) => r.message)).toEqual([PRIVATE_BOT_MESSAGE]);
    expect(await prisma.botTelegramLink.count({ where: { householdId: h.householdId } })).toBe(0);
  });

  it("cinco códigos errados numa hora: 24 h de silêncio, nem a frase", async () => {
    for (let i = 0; i < 5; i++) await send(tgText(chats.stranger, `/start 00000${i}`), minutes(i));
    const blocked = await send(tgText(chats.stranger, "/start 111111"), minutes(6));
    expect(blocked.result?.outcome).toBe("BAD_CODE");
    expect(blocked.result?.replies).toEqual([]);
  });
});

describe("lançar pelo Telegram", () => {
  beforeEach(async () => {
    await linkTelegram(h.holder.id, chats.holder);
    await saveBotPreference(prisma, await grantOf(h.holder.id), {
      walletId: h.home.id,
      debitAccountId: h.checking.id,
      creditCardId: h.holderCard.id,
    });
  });

  it("a mesma proposta do WhatsApp; o Confirmar troca a mensagem do botão e lança uma vez", async () => {
    const { result } = await send(tgText(chats.holder, "gastei 42,90 no mercado"));
    expect(result?.outcome).toBe("PROPOSED");
    expect(result?.replies[0]?.replace).toBeNull();
    const confirmId = result!.replies[0]!.message.buttons![0]!.id;
    const confirmed = await send(tgButton(chats.holder, confirmId, "501"), minutes(1));
    expect(confirmed.result?.outcome).toBe("CONFIRMED");
    expect(confirmed.result?.replies[0]?.replace).toBe("501");
    expect(confirmed.result?.incoming.callbackId).toMatch(/^cb-/);
    const rows = await prisma.transaction.findMany({ where: { householdId: h.householdId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "BOT", createdById: h.holder.id });
    expect(await auditActions(h.householdId)).toContain("bot.entry_confirmed");
  });

  it("o botão de uma proposta de outra pessoa é ignorado", async () => {
    await linkTelegram(h.partner.id, chats.partner);
    const { result } = await send(tgText(chats.holder, "gastei 10 no mercado"));
    const draft = await prisma.botDraft.findFirstOrThrow({ where: { userId: h.holder.id } });
    expect(result?.outcome).toBe("PROPOSED");
    const stolen = await send(
      tgButton(chats.partner, encodeAction({ kind: "CONFIRM", draftId: draft.id }), "7"),
    );
    expect(stolen.result?.outcome).toBe("STALE");
    expect(await prisma.transaction.count({ where: { householdId: h.householdId } })).toBe(0);
  });

  it("número de cartão: a mensagem sai da conversa, nada é guardado, a resposta diz isso", async () => {
    const digits = ["4111", "1111", "1111", "1111"].join(" ");
    const { result } = await send(tgText(chats.holder, `${digits} compra 99`, "42"));
    expect(result?.outcome).toBe("CARD_NUMBER");
    expect(result?.discard).toBe(true);
    expect(result?.incoming.messageId).toBe("42");
    expect(result?.replies.map((r) => r.message)).toEqual([CARD_NUMBER_REMOVED_MESSAGE]);
    expect(await prisma.botDraft.count({ where: { userId: h.holder.id } })).toBe(0);
    // No WhatsApp o bot não consegue apagar: a resposta de sempre, sem discard
    expect(notUnderstoodMessage("CARD_NUMBER")).not.toEqual(CARD_NUMBER_REMOVED_MESSAGE);
  });

  it("o /start de quem já está vinculado: o jeito de escrever, nada vinculado de novo", async () => {
    const { result } = await send(tgText(chats.holder, "/start"));
    expect(result?.outcome).toBe("NOT_UNDERSTOOD");
    expect(result?.replies.map((r) => r.message)).toEqual([notUnderstoodMessage("EMPTY")]);
  });
});

describe("a recusa da Meta na tela (M12.0b)", () => {
  it("a última recusa depois da última aceita aparece; uma resposta aceita apaga o aviso", async () => {
    const id = `9${randomUUID().replace(/\D/g, "").slice(0, 10)}`;
    await recordReplyResult(prisma, id, { ok: true }, minutes(0));
    await recordReplyResult(prisma, id, { ok: false, code: 131037 }, minutes(1));
    expect((await botReplyUsage(prisma, id, minutes(2))).failing).toEqual({
      code: 131037,
      at: minutes(1),
    });
    await recordReplyResult(prisma, id, { ok: true }, minutes(3));
    expect((await botReplyUsage(prisma, id, minutes(4))).failing).toBeNull();
    await prisma.botReplyCount.deleteMany({ where: { phoneNumberId: id } });
  });
});

describe("regras da migração (M12.0b)", () => {
  it("bot_telegram_link_chat_check: só o HMAC de 64 hexadecimais, nunca o id da conversa", async () => {
    expect(
      await dbError(
        prisma.botTelegramLink.create({
          data: {
            userId: h.holder.id,
            householdId: h.householdId,
            chatHash: chats.holder.padEnd(64, "x"),
          },
        }),
      ),
    ).toContain("bot_telegram_link_chat_check");
  });

  it("bot_link_code_channel_check: o canal só depois do uso", async () => {
    const created = await createLinkCode(
      prisma,
      await grantOf(h.holder.id),
      deps.keyring,
      TEST_CTX,
      BOT_CLOCK,
    );
    expect(
      await dbError(
        prisma.botLinkCode.update({ where: { id: created.id }, data: { usedChannel: "TELEGRAM" } }),
      ),
    ).toContain("bot_link_code_channel_check");
  });

  it("bot_message_channel_check: o id do Telegram começa com tg: e só ele", async () => {
    const base = {
      phoneHash: telegramChatHash(deps.phoneKey, chats.stranger),
      kind: "TEXT" as const,
      sentAt: BOT_CLOCK,
      processedAt: BOT_CLOCK,
      outcome: "UNKNOWN_NUMBER" as const,
    };
    expect(
      await dbError(
        prisma.botMessage.create({
          data: { ...base, channel: "TELEGRAM", wamid: `wamid.${randomUUID()}` },
        }),
      ),
    ).toContain("bot_message_channel_check");
    expect(
      await dbError(
        prisma.botMessage.create({
          data: { ...base, channel: "WHATSAPP", wamid: `tg:${randomUUID()}` },
        }),
      ),
    ).toContain("bot_message_channel_check");
  });

  it("bot_reply_count_failure_check: código e hora da recusa juntos", async () => {
    const id = `8${randomUUID().replace(/\D/g, "").slice(0, 10)}`;
    expect(
      await dbError(
        prisma.botReplyCount.create({
          data: { phoneNumberId: id, month: "2026-10", lastFailureAt: BOT_CLOCK },
        }),
      ),
    ).toContain("bot_reply_count_failure_check");
  });
});
