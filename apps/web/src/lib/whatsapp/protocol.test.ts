import { describe, expect, it } from "vitest";
import {
  META_ERROR_HINTS,
  metaErrorOf,
  outgoingMessage,
  parseWebhook,
  readReceipt,
  signatureFor,
  validSignature,
} from "./protocol";

// Corpo no formato da Meta, com dados inventados (número +55 41 90000-0001, ids sintéticos)
const PHONE_ID = "100000000000001";
const body = (messages: unknown[], phoneNumberId = PHONE_ID) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "200000000000001",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "15550100000", phone_number_id: phoneNumberId },
            contacts: [{ profile: { name: "Lia" }, wa_id: "5541900000001" }],
            messages,
          },
        },
      ],
    },
  ],
});
const text = (id: string, value: string) => ({
  from: "5541900000001",
  id,
  timestamp: "1792610400",
  type: "text",
  text: { body: value },
});

describe("assinatura do webhook", () => {
  const secret = "segredo-do-app-de-mentira-0001";
  const raw = new TextEncoder().encode(JSON.stringify(body([text("wamid.A", "oi")])));

  it("aceita só a assinatura do corpo exato", () => {
    expect(validSignature(raw, signatureFor(raw, secret), secret)).toBe(true);
    // Um byte a mais no corpo: recusada
    const tampered = new Uint8Array([...raw, 0x20]);
    expect(validSignature(tampered, signatureFor(raw, secret), secret)).toBe(false);
    // Outra chave: recusada
    expect(validSignature(raw, signatureFor(raw, "outro-segredo-qualquer-0002"), secret)).toBe(
      false,
    );
  });

  it("recusa cabeçalho ausente, sem prefixo, curto ou com lixo", () => {
    const hex = signatureFor(raw, secret).slice("sha256=".length);
    for (const header of [null, "", hex, `sha1=${hex}`, `sha256=${hex.slice(1)}`, `sha256=${hex}x`])
      expect(validSignature(raw, header, secret)).toBe(false);
  });
});

describe("parseWebhook", () => {
  it("texto e clique em botão viram mensagens; o resto vira OTHER", () => {
    const parsed = parseWebhook(
      body([
        text("wamid.A", "gastei 42,90 no mercado"),
        {
          from: "5541900000001",
          id: "wamid.B",
          timestamp: "1792610401",
          type: "interactive",
          interactive: { type: "button_reply", button_reply: { id: "c:x", title: "Confirmar" } },
        },
        { from: "5541900000001", id: "wamid.C", timestamp: "1792610402", type: "audio", audio: {} },
      ]),
      PHONE_ID,
    );
    expect(parsed).toEqual([
      {
        wamid: "wamid.A",
        from: "5541900000001",
        kind: "TEXT",
        sentAt: new Date(1792610400 * 1000),
        text: "gastei 42,90 no mercado",
      },
      {
        wamid: "wamid.B",
        from: "5541900000001",
        kind: "BUTTON",
        sentAt: new Date(1792610401 * 1000),
        buttonId: "c:x",
      },
      {
        wamid: "wamid.C",
        from: "5541900000001",
        kind: "OTHER",
        sentAt: new Date(1792610402 * 1000),
      },
    ]);
  });

  it("de outro número do app, status de entrega e lixo: nada", () => {
    expect(parseWebhook(body([text("wamid.A", "oi")], "999"), PHONE_ID)).toEqual([]);
    expect(
      parseWebhook(
        {
          object: "whatsapp_business_account",
          entry: [
            {
              changes: [
                {
                  field: "messages",
                  value: {
                    metadata: { phone_number_id: PHONE_ID },
                    statuses: [{ id: "wamid.X", status: "read" }],
                  },
                },
              ],
            },
          ],
        },
        PHONE_ID,
      ),
    ).toEqual([]);
    for (const junk of [
      null,
      1,
      "x",
      [],
      {},
      { object: "page" },
      { object: "whatsapp_business_account", entry: "x" },
    ])
      expect(parseWebhook(junk, PHONE_ID)).toEqual([]);
    // Remetente que não é número, ou wamid gigante: descartado
    expect(parseWebhook(body([{ ...text("wamid.A", "oi"), from: "abc" }]), PHONE_ID)).toEqual([]);
    expect(parseWebhook(body([text("w".repeat(201), "oi")]), PHONE_ID)).toEqual([]);
  });
});

describe("o que o FinTrack manda", () => {
  it("texto simples, com o cabeçalho em negrito", () => {
    expect(outgoingMessage("5541900000001", { header: "Lançar assim?", body: "R$ 42,90" })).toEqual(
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: "5541900000001",
        type: "text",
        text: { body: "*Lançar assim?*\nR$ 42,90", preview_url: false },
      },
    );
  });

  it("com botões de resposta", () => {
    const message = outgoingMessage("5541900000001", {
      body: "R$ 42,90",
      buttons: [{ id: "c:1", title: "Confirmar" }],
    });
    expect(message).toMatchObject({
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "R$ 42,90" },
        action: { buttons: [{ type: "reply", reply: { id: "c:1", title: "Confirmar" } }] },
      },
    });
  });

  it("marcar como lida", () => {
    expect(readReceipt("wamid.A")).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.A",
    });
  });
});

describe("o erro que a Meta devolve (M11.2)", () => {
  it("lê o código, o subcódigo e o nome curto; nunca a mensagem de texto", () => {
    // Formato da Graph API; o texto da Meta pode repetir o número de quem recebe
    const error = metaErrorOf({
      error: {
        message: "(#131030) Recipient phone number not in allowed list +5541900000001",
        type: "OAuthException",
        code: 131030,
        error_subcode: 2494010,
        fbtrace_id: "Azz000000000000",
      },
    });
    expect(error).toEqual({ code: 131030, subcode: 2494010, hint: "fora_da_lista_de_teste" });
    expect(JSON.stringify(error)).not.toContain("5541900000001");
  });

  it("token vencido: 190", () => {
    expect(metaErrorOf({ error: { code: 190, error_subcode: 463 } }).hint).toBe("token_invalido");
  });

  it("código desconhecido: o número sem nome; corpo estranho: tudo null", () => {
    expect(metaErrorOf({ error: { code: 4 } })).toEqual({ code: 4, subcode: null, hint: null });
    for (const body of [null, "texto", [], {}, { error: "x" }, { error: { code: "131030" } }]) {
      expect(metaErrorOf(body)).toEqual({ code: null, subcode: null, hint: null });
    }
    expect(metaErrorOf({ error: { code: -1, error_subcode: 1.5 } })).toEqual({
      code: null,
      subcode: null,
      hint: null,
    });
  });

  it("todo nome curto é minúsculo, sem espaço (vai para o log como está)", () => {
    for (const hint of Object.values(META_ERROR_HINTS)) expect(hint).toMatch(/^[a-z0-9_]+$/);
  });
});
