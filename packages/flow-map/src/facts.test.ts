import { afterAll, describe, expect, it } from "vitest";
import { prismaModels, sqlTables } from "./facts";
import { makeRepo } from "./testing/fixture";
import { HOSTILE, timed } from "./testing/timing";

describe("as tabelas do Prisma e do SQL escrito à mão", () => {
  const repo = makeRepo({
    "packages/db/prisma/schema/a.prisma": [
      "model FinancialAccount {",
      "  id String @id",
      '  @@map("financial_account")',
      "}",
      "",
      "model Wallet {",
      "  id String @id",
      "}",
      "model Aberto {",
    ].join("\n"),
  });
  afterAll(() => repo.cleanup());

  it("lê cada model com a tabela do @@map (ou o próprio nome) e o nome no cliente", () => {
    expect(prismaModels(repo.root)).toEqual([
      { model: "FinancialAccount", table: "financial_account", accessor: "financialAccount" },
      { model: "Wallet", table: "Wallet", accessor: "wallet" },
    ]);
  });

  it("acha a tabela depois de FROM, JOIN, UPDATE e INTO, com ou sem aspas, nunca por pedaço", () => {
    const sql = [
      'SELECT 1 FROM "transaction" t JOIN wallet_member wm ON true',
      "update account_balance set x = 1; insert into audit_log(a) values (1)",
      'SELECT "wallet" FROM "wallet_member"',
    ];
    expect([...sqlTables(sql)].sort()).toEqual([
      "account_balance",
      "audit_log",
      "transaction",
      "wallet_member",
    ]);
  });

  it("não fica lento com um schema ou um SQL estranho (CodeQL js/polynomial-redos)", () => {
    const hostile = makeRepo({
      "packages/db/prisma/schema/a.prisma": "model A {\n".repeat(HOSTILE),
    });
    try {
      expect(timed(() => prismaModels(hostile.root))).toBeLessThan(300);
    } finally {
      hostile.cleanup();
    }
    expect(timed(() => sqlTables(["FROM ".repeat(HOSTILE)]))).toBeLessThan(300);
  });
});
