// O canal do Telegram (M12.0b): o endereço com o token, a resposta que edita a mensagem do botão
// (e cai para uma nova quando ela sumiu), o toque confirmado e a mensagem apagada. O fetch é de
// mentira: nenhum teste fala com o Telegram.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { telegramChannel } = await import("./channel");
const { ChannelError } = await import("@/lib/bot/channel-error");

const CONFIG = {
  token: "1000000001:token-de-mentira-do-telegram-000001", // gitleaks:allow
  webhookSecret: "segredo-de-mentira-do-telegram-0000000001", // gitleaks:allow
  botUsername: "FinTrackExemploBot",
  apiUrl: "https://api.telegram.org",
};
const REF = { externalId: "tg:1", chat: "700000001", messageId: "55", callbackId: "cb-1" };

afterEach(() => vi.unstubAllGlobals());

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn<typeof fetch>(
    async () => responses.shift() ?? Response.json({ ok: true }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const methodOf = (call: Parameters<typeof fetch>) => String(call[0]).split("/").at(-1);

describe("telegramChannel", () => {
  it("manda para /bot<token>/sendMessage", async () => {
    const fetchMock = stubFetch(Response.json({ ok: true, result: {} }));
    await telegramChannel(CONFIG).send(REF.chat, { body: "Lançado." });
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      `https://api.telegram.org/bot${CONFIG.token}/sendMessage`,
    );
  });

  it("com replace, edita a mensagem do botão; se ela sumiu, manda uma nova", async () => {
    const fetchMock = stubFetch(
      Response.json(
        { ok: false, error_code: 400, description: "Bad Request: message to edit not found" },
        { status: 400 },
      ),
      Response.json({ ok: true, result: {} }),
    );
    await telegramChannel(CONFIG).send(REF.chat, { body: "Lançado." }, "57");
    expect(fetchMock.mock.calls.map(methodOf)).toEqual(["editMessageText", "sendMessage"]);
  });

  it("o mesmo botão tocado duas vezes (mensagem igual) não é erro", async () => {
    stubFetch(
      Response.json(
        { ok: false, error_code: 400, description: "Bad Request: message is not modified" },
        { status: 400 },
      ),
    );
    await expect(
      telegramChannel(CONFIG).send(REF.chat, { body: "Lançado." }, "57"),
    ).resolves.toBeUndefined();
  });

  it("recusa vira ChannelError com o código, sem o texto nem o token", async () => {
    stubFetch(
      Response.json(
        { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" },
        { status: 403 },
      ),
    );
    const error = await telegramChannel(CONFIG)
      .send(REF.chat, { body: "Lançado." })
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ChannelError);
    expect(error).toMatchObject({ status: 403, code: 403, hint: "bloqueado_pela_pessoa" });
    expect((error as Error).message).toBe("o Telegram respondeu 403 (código 403)");
    expect((error as Error).message).not.toContain(CONFIG.token);
  });

  it("confirma o toque e apaga a mensagem; sem toque ou sem mensagem, nada", async () => {
    const fetchMock = stubFetch();
    const channel = telegramChannel(CONFIG);
    await channel.acknowledge(REF);
    await channel.discard(REF);
    await channel.acknowledge({ ...REF, callbackId: null });
    await channel.discard({ ...REF, messageId: null });
    expect(fetchMock.mock.calls.map(methodOf)).toEqual(["answerCallbackQuery", "deleteMessage"]);
  });
});
