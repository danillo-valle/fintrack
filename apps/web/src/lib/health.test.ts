import { describe, expect, it } from "vitest";
import { buildHealth, healthStatusCode, withTimeout } from "./health";

const OK = { status: "ok" } as const;

describe("buildHealth", () => {
  it("responde ok com o nome do serviço quando o banco responde", () => {
    const health = buildHealth({ database: OK, databaseLatencyMs: 3 });
    expect(health.status).toBe("ok");
    expect(health.service).toBe("fintrack-web");
    expect(health.checks.database).toEqual({ status: "ok", latencyMs: 3 });
    expect(healthStatusCode(health)).toBe(200);
  });

  it("responde fail e 503 quando o banco não responde", () => {
    const health = buildHealth({
      database: { status: "fail", reason: "timeout" },
      databaseLatencyMs: 2000,
    });
    expect(health.status).toBe("fail");
    expect(health.checks.database.status).toBe("fail");
    expect(healthStatusCode(health)).toBe(503);
  });

  it("usa a data recebida, em formato ISO", () => {
    const fixed = new Date("2026-10-01T12:00:00.000Z");
    expect(buildHealth({ database: OK, databaseLatencyMs: 1, now: fixed }).time).toBe(
      "2026-10-01T12:00:00.000Z",
    );
  });

  it('usa "dev" quando APP_VERSION não está definida', () => {
    delete process.env.APP_VERSION;
    expect(buildHealth({ database: OK, databaseLatencyMs: 1 }).version).toBe("dev");
  });

  it("usa APP_VERSION quando ela existe (o commit gravado no build da imagem)", () => {
    process.env.APP_VERSION = "0123456789abcdef0123456789abcdef01234567";
    expect(buildHealth({ database: OK, databaseLatencyMs: 1 }).version).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
    delete process.env.APP_VERSION;
  });

  it("arredonda a latência para milissegundos inteiros", () => {
    expect(buildHealth({ database: OK, databaseLatencyMs: 4.7 }).checks.database.latencyMs).toBe(5);
  });
});

describe("withTimeout", () => {
  it("devolve o valor quando a promessa termina a tempo", async () => {
    await expect(withTimeout(Promise.resolve(42), 100)).resolves.toEqual({ ok: true, value: 42 });
  });

  it("desiste quando a promessa demora demais", async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 200));
    await expect(withTimeout(slow, 20)).resolves.toEqual({ ok: false, reason: "timeout" });
  });

  it("devolve erro (sem lançar) quando a promessa falha", async () => {
    const result = await withTimeout(Promise.reject(new Error("conexão recusada")), 100);
    expect(result).toMatchObject({ ok: false, reason: "error" });
  });
});
