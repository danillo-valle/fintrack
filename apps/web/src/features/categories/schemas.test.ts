// Categorias e regras (M07).
import { describe, expect, it } from "vitest";
import { categorySchema, ruleSchema } from "./schemas";

const C = "0199b5c2-7d0e-7a3b-8c1d-2e3f4a5b6c7d";

describe("categorySchema", () => {
  it("principal (sem pai) e subcategoria", () => {
    expect(categorySchema.parse({ name: " Mercado ", kind: "EXPENSE" })).toEqual({
      name: "Mercado",
      kind: "EXPENSE",
      parentId: null,
    });
    expect(
      categorySchema.parse({ name: "Hortifruti", kind: "EXPENSE", parentId: C }).parentId,
    ).toBe(C);
  });

  it("recusa nome vazio e tipo inventado", () => {
    expect(categorySchema.safeParse({ name: " ", kind: "EXPENSE" }).success).toBe(false);
    expect(categorySchema.safeParse({ name: "X", kind: "TRANSFER" }).success).toBe(false);
  });
});

describe("ruleSchema", () => {
  it("contém é o padrão; recusa texto curto e comparação inventada (sem regex de propósito)", () => {
    expect(ruleSchema.parse({ pattern: "mercado", categoryId: C }).match).toBe("CONTAINS");
    expect(ruleSchema.safeParse({ pattern: "m", categoryId: C }).success).toBe(false);
    expect(ruleSchema.safeParse({ pattern: "mer.*", match: "REGEX", categoryId: C }).success).toBe(
      false,
    );
  });
});
