import { describe, expect, it, vi } from "vitest";
import { authErrorMessage } from "./messages";

vi.mock("../logger", () => ({ logger: { warn: vi.fn() } }));

const { checkLeakedPassword, compromiseCount, leakedPasswordCheck, PWNED_RANGE_URL } =
  await import("./leaked-password");
const { logger } = await import("../logger");

// O exemplo publicado na documentação do Pwned Passwords ("P@ssw0rd"), com o SHA-1 escrito à mão:
// o teste confere o protocolo contra um valor de fora, sem recalcular o hash com o mesmo código
// que testa. O teste nunca fala com o HIBP de verdade (o fetch é sempre de mentira).
const PASSWORD = "P@ssw0rd";
const PREFIX = "21BD1";
const SUFFIX = "2DC183F740EE76F27B78EB39C8AD972A757";

function answering(body: string, status = 200) {
  return vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
    async () => new Response(body, { status }),
  );
}

/** Um HIBP que nunca responde: só termina quando o sinal do tempo limite aborta. */
function hanging() {
  return vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
  );
}

describe("compromiseCount", () => {
  it("acha o sufixo sem diferenciar maiúsculas e ignora as linhas de enchimento (0)", () => {
    const body = `0000000000000000000000000000000000A:0\r\n${SUFFIX.toLowerCase()}:42\r\nFFFF:3`;
    expect(compromiseCount(body, SUFFIX)).toBe(42);
    expect(compromiseCount("AAAA:1\nBBBB:2", SUFFIX)).toBe(0);
  });

  it("recusa uma contagem estranha em vez de adivinhar", () => {
    expect(() => compromiseCount(`${SUFFIX}:muitas`, SUFFIX)).toThrow();
  });
});

describe("checkLeakedPassword", () => {
  it("manda só os 5 primeiros caracteres do SHA-1, com o enchimento ligado", async () => {
    const fetch = answering("AAAA:1");
    await expect(checkLeakedPassword(PASSWORD, { fetch })).resolves.toBe("ok");
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${PWNED_RANGE_URL}${PREFIX}`);
    expect(url).not.toContain(SUFFIX);
    expect(JSON.stringify(init)).not.toContain(PASSWORD);
    expect((init.headers as Record<string, string>)["Add-Padding"]).toBe("true");
  });

  it("senha que aparece na resposta = vazada", async () => {
    await expect(checkLeakedPassword(PASSWORD, { fetch: answering(`${SUFFIX}:7`) })).resolves.toBe(
      "leaked",
    );
  });

  it("sem resposta no tempo limite = não deu para saber (e não espera para sempre)", async () => {
    const started = Date.now();
    await expect(checkLeakedPassword(PASSWORD, { fetch: hanging(), timeoutMs: 50 })).resolves.toBe(
      "unavailable",
    );
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("erro de rede, status diferente de 200 ou resposta estranha = não deu para saber", async () => {
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(checkLeakedPassword(PASSWORD, { fetch: offline })).resolves.toBe("unavailable");
    await expect(checkLeakedPassword(PASSWORD, { fetch: answering("", 503) })).resolves.toBe(
      "unavailable",
    );
    await expect(checkLeakedPassword(PASSWORD, { fetch: answering(`${SUFFIX}:x`) })).resolves.toBe(
      "unavailable",
    );
  });
});

describe("leakedPasswordCheck (o plugin)", () => {
  // O plugin troca o hash do Better Auth: confere a senha e só então chama o hash de verdade
  function hashWith(options: Parameters<typeof leakedPasswordCheck>[0]) {
    const realHash = vi.fn(async (p: string) => `hash(${p.length})`);
    const plugin = leakedPasswordCheck(options);
    const init = plugin.init as unknown as (ctx: { password: { hash: typeof realHash } }) => {
      context: { password: { hash: typeof realHash } };
    };
    return { hash: init({ password: { hash: realHash } }).context.password.hash, realHash };
  }

  it("senha conferida segue para o hash", async () => {
    const { hash, realHash } = hashWith({ enabled: true, fetch: answering("AAAA:1") });
    await expect(hash(PASSWORD)).resolves.toBe(`hash(${PASSWORD.length})`);
    expect(realHash).toHaveBeenCalledOnce();
  });

  it("senha vazada é recusada com PASSWORD_COMPROMISED e nada é guardado", async () => {
    const { hash, realHash } = hashWith({ enabled: true, fetch: answering(`${SUFFIX}:7`) });
    await expect(hash(PASSWORD)).rejects.toMatchObject({ body: { code: "PASSWORD_COMPROMISED" } });
    expect(realHash).not.toHaveBeenCalled();
  });

  it("sem resposta em tempo: recusa com PASSWORD_CHECK_UNAVAILABLE, loga só o evento", async () => {
    const { hash, realHash } = hashWith({ enabled: true, fetch: hanging(), timeoutMs: 50 });
    const error = await hash(PASSWORD).catch((e: unknown) => e);
    expect(error).toMatchObject({ body: { code: "PASSWORD_CHECK_UNAVAILABLE" } });
    expect(realHash).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith({ event: "auth.password_check_unavailable" });
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(PREFIX);
    // A tela traduz o código para português
    expect(authErrorMessage({ code: "PASSWORD_CHECK_UNAVAILABLE" })).toMatch(/Tente de novo/);
  });

  it("desligado (HIBP_CHECK=off): não pergunta nada", async () => {
    const fetch = answering(`${SUFFIX}:7`);
    const { hash } = hashWith({ enabled: false, fetch });
    await expect(hash(PASSWORD)).resolves.toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
});
