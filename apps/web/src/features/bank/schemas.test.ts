import { describe, expect, it } from "vitest";
import { credentialsInput, credentialsSchema, parseLinkForm, setCategorySchema } from "./schemas";

const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.set(k, v);
  return data;
};

describe("credenciais", () => {
  it("junta os Item IDs, tira repetidos e vazios, e mantém o segredo vazio como 'manter'", () => {
    const parsed = credentialsSchema.parse(
      credentialsInput(
        form({
          clientId: " 0f1e2d3c-0000-4000-8000-00000000c1d0 ",
          clientSecret: "",
          "item-1": "a1b2c3d4-0000-4000-8000-000000000001",
          "item-2": "a1b2c3d4-0000-4000-8000-000000000001",
          "item-3": "",
        }),
      ),
    );
    expect(parsed).toEqual({
      clientId: "0f1e2d3c-0000-4000-8000-00000000c1d0",
      clientSecret: null,
      itemIds: ["a1b2c3d4-0000-4000-8000-000000000001"],
    });
  });

  it("recusa Item ID com espaço, URL ou script", () => {
    for (const bad of ["item id", "https://x.y", "<script>"]) {
      expect(
        credentialsSchema.safeParse({ clientId: "12345678", clientSecret: "", itemIds: [bad] })
          .success,
      ).toBe(false);
    }
  });
});

describe("ligar as contas", () => {
  const acc = "0199aaaa-0000-7000-8000-000000000001";
  const card = "0199bbbb-0000-7000-8000-000000000001";
  const wallet = "0199cccc-0000-7000-8000-000000000001";

  it("lê a escolha de cada conta e o ambiente de cada cartão", () => {
    const parsed = parseLinkForm(
      form({
        importFrom: "2026-09-01",
        "conta:5a1e0001": `existing:${acc}`,
        "conta:5a1e0002": "new",
        "conta:5a1e0003": "skip",
        [`cartao:${card}`]: wallet,
      }),
    );
    expect(parsed).toEqual({
      ok: true,
      data: {
        importFrom: "2026-09-01",
        choices: [
          { externalId: "5a1e0001", target: "existing", accountId: acc },
          { externalId: "5a1e0002", target: "new" },
          { externalId: "5a1e0003", target: "skip" },
        ],
        cardWallets: [{ cardId: card, walletId: wallet }],
      },
    });
  });

  it("recusa valores inventados", () => {
    expect(parseLinkForm(form({ importFrom: "2026-09-01", "conta:x": "drop table" })).ok).toBe(
      false,
    );
    expect(parseLinkForm(form({ importFrom: "ontem", "conta:x": "new" })).ok).toBe(false);
    expect(
      parseLinkForm(
        form({ importFrom: "2026-09-01", "cartao:nao-uuid": "padrao", "conta:x": "new" }),
      ).ok,
    ).toBe(false);
  });
});

describe("categoria em um clique", () => {
  it("o 'sempre categorizar assim' vira booleano", () => {
    const base = {
      transactionId: "0199aaaa-0000-7000-8000-000000000001",
      categoryId: "0199aaaa-0000-7000-8000-000000000002",
    };
    expect(setCategorySchema.parse({ ...base, rememberRule: "on" }).rememberRule).toBe(true);
    expect(setCategorySchema.parse(base).rememberRule).toBe(false);
  });
});
