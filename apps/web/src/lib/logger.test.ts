import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger, maskEmail } from "./logger";

/** Um "arquivo" na memória: guarda cada linha que o logger escreve. */
function memoryStream() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      done();
    },
  });
  return { stream, lines };
}

describe("logger", () => {
  afterEach(() => {
    delete process.env.LOG_LEVEL;
  });

  it("escreve uma linha JSON com nível por extenso, data ISO, serviço e versão", () => {
    process.env.LOG_LEVEL = "info";
    const { stream, lines } = memoryStream();
    createLogger(stream).info({ event: "teste.ok" }, "olá");

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "info",
      service: "fintrack-web",
      event: "teste.ok",
      msg: "olá",
    });
    expect(lines[0]?.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(lines[0]).toHaveProperty("version");
  });

  it("apaga senha, token, cookie e Client Secret mesmo que alguém os passe por engano", () => {
    process.env.LOG_LEVEL = "info";
    const { stream, lines } = memoryStream();
    createLogger(stream).warn(
      {
        password: "minha senha",
        body: { token: "abc", clientSecret: "def" },
        headers: { cookie: "fintrack.session_token=xyz", authorization: "Bearer 123" },
      },
      "tentativa",
    );

    const text = JSON.stringify(lines[0]);
    for (const secret of ["minha senha", "abc", "def", "xyz", "Bearer 123"]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain("[oculto]");
  });

  it("respeita LOG_LEVEL: com warn, info não aparece", () => {
    process.env.LOG_LEVEL = "warn";
    const { stream, lines } = memoryStream();
    const log = createLogger(stream);
    log.info("some");
    log.warn("aparece");
    expect(lines.map((line) => line.msg)).toEqual(["aparece"]);
  });

  it("serializa o erro com mensagem e pilha (campo err)", () => {
    process.env.LOG_LEVEL = "info";
    const { stream, lines } = memoryStream();
    createLogger(stream).error({ err: new Error("conexão recusada") }, "falhou");
    expect(lines[0]?.err).toMatchObject({ type: "Error", message: "conexão recusada" });
  });
});

describe("maskEmail", () => {
  it("esconde a parte antes do @", () => {
    expect(maskEmail("danillo@gmail.com")).toBe("***@gmail.com");
  });

  it("não quebra com texto sem @", () => {
    expect(maskEmail("sem-arroba")).toBe("***");
  });
});
