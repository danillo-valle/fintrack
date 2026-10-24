// O protocolo do Telegram (M12.0b): o segredo do webhook, o update que vira mensagem (só conversa
// privada), o botão que cabe nos 64 bytes, o JSON das respostas e o código dos erros. Ids de
// conversa inventados (9 dígitos começando em 7000).
import { randomUUID } from "node:crypto";
import { encodeAction } from "@fintrack/core";
import { describe, expect, it } from "vitest";
import {
  answerCallbackCall,
  deleteMessageCall,
  editMessageCall,
  packCallbackData,
  parseUpdate,
  sendMessageCall,
  telegramErrorOf,
  unpackCallbackData,
  validSecret,
} from "./protocol";

const CHAT = 700000001;
const DRAFT = "0199f0c4-3a7e-7c1b-9a35-1d2e3f4a5b6c";
const CARD = "0199f0c4-3a7e-7c1b-9a35-1d2e3f4a5b6d";
const person = { id: CHAT, is_bot: false, first_name: "Lia" };
const chat = { id: CHAT, type: "private" };

describe("o segredo do webhook", () => {
  it("só o segredo exato passa", () => {
    const secret = "segredo-de-mentira-do-telegram-0000000001";
    expect(validSecret(secret, secret)).toBe(true);
    expect(validSecret(null, secret)).toBe(false);
    expect(validSecret(`${secret}x`, secret)).toBe(false);
    expect(validSecret(secret.replace(/1$/, "2"), secret)).toBe(false);
  });
});

describe("o botão nos 64 bytes", () => {
  it("o maior botão do bot (k:<uuid>:<uuid>) cabe e volta igual", () => {
    const id = encodeAction({ kind: "PICK_CARD", draftId: DRAFT, cardId: CARD });
    expect(id.length).toBeGreaterThan(64);
    const packed = packCallbackData(id);
    expect(Buffer.byteLength(packed)).toBeLessThanOrEqual(64);
    expect(unpackCallbackData(packed)).toBe(id);
  });

  it("qualquer uuid vai e volta", () => {
    for (let i = 0; i < 500; i++) {
      const id = `w:${randomUUID()}:${randomUUID()}`;
      expect(unpackCallbackData(packCallbackData(id))).toBe(id);
    }
  });

  it("dado fora do formato: nulo", () => {
    for (const data of [
      "",
      "c",
      "z:AAAAAAAAAAAAAAAAAAAAAA",
      "c:curto",
      `c:${DRAFT}`,
      "c:A/AAAAAAAAAAAAAAAAAAAA",
    ])
      expect(unpackCallbackData(data)).toBeNull();
  });
});

describe("o update que chega", () => {
  it("texto numa conversa privada vira TEXT com o id da conversa e o da mensagem", () => {
    const [message] = parseUpdate({
      update_id: 900001,
      message: {
        message_id: 55,
        date: 1792860000,
        chat,
        from: person,
        text: "gastei 42,90 no mercado",
      },
    });
    expect(message).toEqual({
      channel: "TELEGRAM",
      wamid: "tg:900001",
      from: String(CHAT),
      kind: "TEXT",
      text: "gastei 42,90 no mercado",
      sentAt: new Date(1792860000 * 1000),
      messageId: "55",
    });
  });

  it("foto ou figurinha vira OTHER (o bot responde que só lê texto)", () => {
    const [message] = parseUpdate({
      update_id: 900002,
      message: { message_id: 56, date: 1792860000, chat, from: person, photo: [] },
    });
    expect(message?.kind).toBe("OTHER");
  });

  it("o toque num botão vira BUTTON com o id do toque e a mensagem do bot", () => {
    const [message] = parseUpdate({
      update_id: 900003,
      callback_query: {
        id: "4382bfdwdsb323b2d9",
        from: person,
        data: packCallbackData(encodeAction({ kind: "CONFIRM", draftId: DRAFT })),
        message: { message_id: 57, date: 1792860000, chat, from: { id: 1, is_bot: true } },
      },
    });
    expect(message).toMatchObject({
      kind: "BUTTON",
      from: String(CHAT),
      buttonId: `c:${DRAFT}`,
      callbackId: "4382bfdwdsb323b2d9",
      buttonMessageId: "57",
    });
  });

  it("grupo, canal, mensagem editada, outro bot e JSON torto: nada", () => {
    const group = { id: -100123, type: "supergroup" };
    for (const body of [
      null,
      [],
      { update_id: "1" },
      { update_id: 1, message: { message_id: 1, date: 1, chat: group, from: person, text: "oi" } },
      { update_id: 1, edited_message: { message_id: 1, date: 1, chat, from: person, text: "oi" } },
      { update_id: 1, channel_post: { message_id: 1, date: 1, chat, text: "oi" } },
      {
        update_id: 1,
        message: { message_id: 1, date: 1, chat, from: { ...person, is_bot: true }, text: "oi" },
      },
      {
        update_id: 1,
        message: {
          message_id: 1,
          date: 1,
          chat: { id: 2, type: "private" },
          from: person,
          text: "oi",
        },
      },
    ])
      expect(parseUpdate(body)).toEqual([]);
  });
});

describe("as respostas", () => {
  const proposal = {
    header: "Lançar assim?",
    body: "R$ 42,90 · Mercado",
    buttons: [
      { id: encodeAction({ kind: "CONFIRM", draftId: DRAFT }), title: "Confirmar" },
      { id: encodeAction({ kind: "CANCEL", draftId: DRAFT }), title: "Cancelar" },
    ],
  };

  it("título em negrito por entidade (sem marcação no texto) e botões numa linha", () => {
    const { method, payload } = sendMessageCall(String(CHAT), proposal);
    expect(method).toBe("sendMessage");
    expect(payload).toMatchObject({
      chat_id: String(CHAT),
      text: "Lançar assim?\nR$ 42,90 · Mercado",
      entities: [{ type: "bold", offset: 0, length: "Lançar assim?".length }],
    });
    expect(payload).not.toHaveProperty("parse_mode");
    const keyboard = (payload.reply_markup as { inline_keyboard: { text: string }[][] })
      .inline_keyboard;
    expect(keyboard).toHaveLength(1);
    expect(keyboard[0]!.map((b) => b.text)).toEqual(["Confirmar", "Cancelar"]);
  });

  it("editar sem botões tira o teclado (nenhum botão velho)", () => {
    const { method, payload } = editMessageCall(String(CHAT), "57", { body: "Cancelado." });
    expect(method).toBe("editMessageText");
    expect(payload).toMatchObject({ message_id: 57, reply_markup: { inline_keyboard: [] } });
  });

  it("confirmar o toque e apagar a mensagem", () => {
    expect(answerCallbackCall("abc")).toEqual({
      method: "answerCallbackQuery",
      payload: { callback_query_id: "abc" },
    });
    expect(deleteMessageCall(String(CHAT), "55")).toEqual({
      method: "deleteMessage",
      payload: { chat_id: String(CHAT), message_id: 55 },
    });
  });
});

describe("os erros do Telegram", () => {
  it("o código e um nome curto conhecido, nunca o texto", () => {
    expect(
      telegramErrorOf({
        ok: false,
        error_code: 403,
        description: "Forbidden: bot was blocked by the user",
      }),
    ).toEqual({ code: 403, subcode: null, hint: "bloqueado_pela_pessoa" });
    expect(
      telegramErrorOf({
        ok: false,
        error_code: 400,
        description: "Bad Request: message is not modified",
      }),
    ).toMatchObject({ hint: "mensagem_igual" });
    expect(telegramErrorOf({ ok: false, error_code: 400, description: "outra coisa" })).toEqual({
      code: 400,
      subcode: null,
      hint: null,
    });
    expect(telegramErrorOf("<html>")).toEqual({ code: null, subcode: null, hint: null });
  });
});
