import { describe, expect, it } from "vitest";
import { describeDevice } from "./device";

describe("describeDevice", () => {
  it("reconhece os aparelhos mais comuns da casa", () => {
    expect(
      describeDevice(
        "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe("Chrome no Android");
    expect(
      describeDevice(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari no iPhone");
    expect(
      describeDevice(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0",
      ),
    ).toBe("Edge no Windows");
  });

  it("sem user agent, não inventa", () => {
    expect(describeDevice(null)).toBe("Aparelho desconhecido");
    expect(describeDevice("curl/8.5.0")).toBe("Aparelho desconhecido");
  });
});
