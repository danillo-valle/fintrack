import { describe, expect, it } from "vitest";
import { toneFor } from "./tone";

describe("toneFor", () => {
  it("o mesmo id dá sempre a mesma cor", () => {
    const id = "e2e00000-0000-4000-8000-00000000a020";
    expect(toneFor(id)).toBe(toneFor(id));
  });
  it("sem id (sem categoria) é neutro", () => {
    expect(toneFor(null)).toBe("neutral");
    expect(toneFor("")).toBe("neutral");
  });
  it("usa as cinco cores: ids diferentes se espalham", () => {
    const tones = new Set(
      Array.from({ length: 50 }, (_, i) =>
        toneFor(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
      ),
    );
    expect(tones).toEqual(new Set([1, 2, 3, 4, 5]));
  });
});
