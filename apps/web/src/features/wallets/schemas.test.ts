// Casos válidos e inválidos das entradas de carteira.
import { describe, expect, it } from "vitest";
import { memberRoleSchema, parseCreateWalletForm, renameWalletSchema } from "./schemas";

const WALLET = "0199b5c2-7d0e-7a3b-8c1d-2e3f4a5b6c7d";

function form(entries: [string, string][]) {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe("parseCreateWalletForm", () => {
  it("lê só as pessoas marcadas, cada uma com o próprio papel", () => {
    const result = parseCreateWalletForm(
      form([
        ["name", " Viagem 2027 "],
        ["member", "u1"],
        ["role:u1", "EDITOR"],
        ["role:u2", "VIEWER"], // u2 não foi marcada: fica de fora
      ]),
    );
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      name: "Viagem 2027",
      members: [{ userId: "u1", role: "EDITOR" }],
    });
  });

  it("aceita carteira só com quem cria (ninguém marcado)", () => {
    expect(parseCreateWalletForm(form([["name", "Só minha"]])).data?.members).toEqual([]);
  });

  it("recusa papel inventado e nome vazio", () => {
    expect(
      parseCreateWalletForm(
        form([
          ["name", "X"],
          ["member", "u1"],
          ["role:u1", "ADMIN"],
        ]),
      ).success,
    ).toBe(false);
    const empty = parseCreateWalletForm(form([["name", "  "]]));
    expect(empty.error?.issues[0]?.message).toBe("Dê um nome à carteira.");
  });
});

describe("renameWalletSchema e memberRoleSchema", () => {
  it("exigem walletId em formato UUID", () => {
    expect(renameWalletSchema.safeParse({ walletId: WALLET, name: "Casa" }).success).toBe(true);
    expect(renameWalletSchema.safeParse({ walletId: "../outra", name: "Casa" }).success).toBe(
      false,
    );
  });

  it.each(["OWNER", "EDITOR", "VIEWER"])("aceita o papel %s", (role) => {
    expect(memberRoleSchema.safeParse({ walletId: WALLET, userId: "u1", role }).success).toBe(true);
  });

  it("recusa papel fora da lista", () => {
    expect(
      memberRoleSchema.safeParse({ walletId: WALLET, userId: "u1", role: "owner" }).success,
    ).toBe(false);
  });
});
