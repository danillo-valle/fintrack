import { describe, expect, it } from "vitest";
import { getHealth } from "./health";

describe("getHealth", () => {
  it("responde ok com o nome do serviço", () => {
    const health = getHealth();
    expect(health.status).toBe("ok");
    expect(health.service).toBe("fintrack-web");
  });

  it("usa a data recebida, em formato ISO", () => {
    const fixed = new Date("2026-10-01T12:00:00.000Z");
    expect(getHealth(fixed).time).toBe("2026-10-01T12:00:00.000Z");
  });

  it('usa "dev" quando APP_VERSION não está definida', () => {
    delete process.env.APP_VERSION;
    expect(getHealth().version).toBe("dev");
  });
});
