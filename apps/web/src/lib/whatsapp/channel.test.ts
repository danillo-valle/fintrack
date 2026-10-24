// O canal da Cloud API (M11.2): o endereço com a versão, o token no cabeçalho e, quando a Meta
// recusa, o código do erro (nunca o texto). O fetch é de mentira: nenhum teste fala com a Meta.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./config", () => ({ botConfig: () => null }));

const { ChannelError, cloudApiChannel } = await import("./channel");

const CONFIG = {
  appSecret: "segredo-do-app-de-mentira-0001", // gitleaks:allow
  accessToken: "token-de-mentira-0000000000000001", // gitleaks:allow
  verifyToken: "verificacao-de-mentira-0001", // gitleaks:allow
  phoneNumberId: "100000000000001",
  apiUrl: "https://graph.facebook.com/v26.0",
  displayNumber: null,
  testNumber: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: Response) {
  const fetchMock = vi.fn<typeof fetch>(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("cloudApiChannel", () => {
  it("manda para /v26.0/<id do número>/messages com o token no cabeçalho", async () => {
    const fetchMock = stubFetch(new Response("{}", { status: 200 }));
    await cloudApiChannel(CONFIG).send("5541900000001", { body: "Lançado." });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://graph.facebook.com/v26.0/100000000000001/messages");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${CONFIG.accessToken}`);
  });

  it("recusa da Meta vira ChannelError com o código, sem o texto do erro", async () => {
    stubFetch(
      Response.json(
        {
          error: {
            message: "(#131030) Recipient phone number not in allowed list",
            code: 131030,
            fbtrace_id: "Azz000000000000",
          },
        },
        { status: 400 },
      ),
    );
    const error = await cloudApiChannel(CONFIG)
      .send("5541900000001", { body: "Lançado." })
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ChannelError);
    expect(error).toMatchObject({
      status: 400,
      code: 131030,
      subcode: null,
      hint: "fora_da_lista_de_teste",
    });
    expect((error as Error).message).toBe("a Cloud API respondeu 400 (código 131030)");
  });

  it("corpo que não é JSON: só o status", async () => {
    stubFetch(new Response("<html>Bad gateway</html>", { status: 502 }));
    const error = await cloudApiChannel(CONFIG)
      .acknowledge({
        externalId: "wamid.A",
        chat: "5541900000001",
        messageId: null,
        callbackId: null,
      })
      .catch((err: unknown) => err);
    expect(error).toMatchObject({ status: 502, code: null, hint: null });
  });
});
