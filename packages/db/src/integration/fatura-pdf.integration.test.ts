// A fatura do cartão em PDF (M09.4): a fatura lida vira Recebidos de origem PDF, a fatura do
// cartão (total, mínimo, encargos) e o vínculo de cada compra com ela; a mesma compra que já
// veio pelo Meu Pluggy ou pelo OFX não entra de novo; a fatura do banco não é trocada; e as
// regras novas do banco. A fatura é a resposta SINTÉTICA do serviço Python
// (packages/importers/fixtures/pdf/, conferida pelo teste de contrato do services/ml).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { invoiceFromService, type StatementFile } from "@fintrack/importers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authorizeAccountUse,
  authorizeScope,
  createFilePreview,
  filePreviewFor,
  FILE_PREVIEW_MS,
  importFilePreview,
  listFileImports,
  type AccountGrant,
} from "../index";
import {
  createTestHousehold,
  dbError,
  deleteTestHousehold,
  prisma,
  TEST_CTX,
  FILE_IMPORT_CLOCK,
  type TestHousehold,
} from "./fixtures";
import { fromDbDecimal, fromDbDecimalOrNull } from "../money";

const FIXTURE = new URL("../../../importers/fixtures/pdf/exemplo-visa-0002.json", import.meta.url);
const invoice = invoiceFromService(JSON.parse(readFileSync(FIXTURE, "utf8")));

// A janela deste arquivo no relógio comum (fixtures.ts, FILE_IMPORT_CLOCK)
const NOW = FILE_IMPORT_CLOCK.pdf;
const later = (ms: number) => new Date(NOW.getTime() + ms);
const day = (d: string) => new Date(`${d}T00:00:00Z`);

async function grantFor(userId: string, accountId: string): Promise<AccountGrant> {
  const access = await authorizeAccountUse(prisma, userId, accountId);
  if (!access.ok) throw new Error(access.reason);
  return access.grant;
}

async function preview(userId: string, statement: StatementFile, now = NOW) {
  return createFilePreview(prisma, {
    scope: await authorizeScope(prisma, userId, "edit"),
    fileName: statement.format === "PDF" ? "fatura.pdf" : "extrato.ofx",
    sha256: randomUUID().replaceAll("-", "").padEnd(64, "0"),
    statement,
    now,
  });
}

async function importInto(h: TestHousehold, statement: StatementFile, now = NOW) {
  const { id } = await preview(h.holder.id, statement, now);
  return importFilePreview(
    prisma,
    { grant: await grantFor(h.holder.id, h.card.id), importId: id, now },
    TEST_CTX,
  );
}

/** Uma compra no cartão, como a busca do Meu Pluggy ou o OFX gravam. */
function purchase(
  h: TestHousehold,
  source: "OPEN_FINANCE" | "OFX",
  amount: string,
  occurredOn: string,
  description: string,
  extra: { statementId?: string } = {},
) {
  return prisma.transaction.create({
    data: {
      householdId: h.householdId,
      walletId: h.holderWallet.id,
      accountId: h.card.id,
      method: "CREDIT",
      amount,
      occurredOn: day(occurredOn),
      description,
      status: "PENDING",
      source,
      externalId: `${source.toLowerCase()}-${randomUUID()}`,
      ...extra,
    },
  });
}

describe("regras novas do banco (M09.4)", () => {
  let h: TestHousehold;
  beforeAll(async () => {
    h = await createTestHousehold();
  });
  afterAll(async () => {
    await deleteTestHousehold(h);
  });

  const base = (kind: "OFX" | "PDF") => ({
    householdId: h.householdId,
    userId: h.holder.id,
    kind,
    sha256: "b".repeat(64),
    fileName: kind === "PDF" ? "fatura.pdf" : "extrato.ofx",
    statementKind: "CREDIT_CARD" as const,
    rowCount: 1,
    expiresAt: later(FILE_PREVIEW_MS),
  });

  it("perfil e diferença da fatura são coisas do PDF; o OFX não tem", async () => {
    const error = await dbError(
      prisma.fileImport.create({ data: { ...base("OFX"), profile: "Genérico" } }),
    );
    expect(error).toContain("file_import_pdf_fields_check");
    const diff = await dbError(
      prisma.fileImport.create({ data: { ...base("OFX"), invoiceDifference: "0.00" } }),
    );
    expect(diff).toContain("file_import_pdf_fields_check");
  });

  it("o nome do perfil cabe na tela (1 a 60)", async () => {
    const error = await dbError(
      prisma.fileImport.create({ data: { ...base("PDF"), profile: "x".repeat(61) } }),
    );
    expect(error).toContain("file_import_profile_check");
  });

  it("lançamento de origem PDF aponta para o arquivo; manual, não", async () => {
    const file = await prisma.fileImport.create({ data: base("PDF"), select: { id: true } });
    const row = (source: "PDF" | "MANUAL") =>
      prisma.transaction.create({
        data: {
          householdId: h.householdId,
          walletId: h.holderWallet.id,
          accountId: h.card.id,
          method: "CREDIT",
          amount: "-1.00",
          occurredOn: day("2026-10-01"),
          description: "Teste",
          source,
          externalId: source === "PDF" ? `p:${randomUUID()}` : null,
          fileImportId: file.id,
        },
      });
    await expect(row("PDF")).resolves.toMatchObject({ source: "PDF" });
    expect(await dbError(row("MANUAL"))).toContain("transaction_file_import_check");
  });
});

describe("a fatura em PDF: conferir, importar e ligar à fatura do cartão", () => {
  let h: TestHousehold;
  beforeAll(async () => {
    h = await createTestHousehold();
    // O Meu Pluggy já trouxe o mercado; o OFX do mês, o posto
    await purchase(h, "OPEN_FINANCE", "-312.48", "2026-10-15", "MERCADO BOM PRECO");
    await purchase(h, "OFX", "-88.40", "2026-10-04", "POSTO ESTRELA");
  });
  afterAll(async () => {
    await deleteTestHousehold(h);
  });

  let firstId: string;

  it("a conferência: o perfil e a fatura que confere ao centavo", async () => {
    firstId = (await preview(h.holder.id, invoice)).id;
    const p = await filePreviewFor(prisma, h.holder.id, firstId, NOW);
    expect(p).toMatchObject({
      format: "PDF",
      profile: "Banco Exemplo",
      statementKind: "CREDIT_CARD",
      lastFour: "0002",
      skipped: 1,
      suggestion: { accountId: h.card.id, reason: "ONLY_ONE" },
      invoice: {
        dueDate: "2026-11-10",
        closingDate: "2026-11-01",
        total: 209351n,
        minimum: 31403n,
        purchases: 205000n,
        difference: 0n,
        matches: true,
      },
    });
    expect(p!.invoice!.charges).toEqual([
      { kind: "IOF", amount: 1351n },
      { kind: "REMUNERATIVE_INTEREST", amount: 3000n },
    ]);
    expect(p!.rows).toHaveLength(10);
  });

  it("importar: as novas como PDF, a do Meu Pluggy e a do OFX não entram de novo", async () => {
    const result = await importFilePreview(
      prisma,
      { grant: await grantFor(h.holder.id, h.card.id), importId: firstId, now: later(60_000) },
      TEST_CTX,
    );
    expect(result).toMatchObject({ created: 8, pluggy: 1, alreadyImported: 1, skipped: 1 });
    expect(result.statementId).not.toBeNull();

    const rows = await prisma.transaction.findMany({
      where: { fileImportId: firstId },
      select: { source: true, status: true, method: true, statementId: true },
    });
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect(row).toMatchObject({
        source: "PDF",
        status: "PENDING",
        method: "CREDIT",
        statementId: result.statementId,
      });
    }
  });

  it("a fatura do cartão: a do vencimento, com total, mínimo e encargos do PDF", async () => {
    const statement = await prisma.cardStatement.findFirstOrThrow({
      where: { accountId: h.card.id },
      include: { charges: { orderBy: { kind: "asc" } } },
    });
    expect(statement).toMatchObject({
      source: "PDF",
      status: "CLOSED",
      externalId: null,
    });
    expect(statement.dueDate).toEqual(day("2026-11-10"));
    expect(fromDbDecimalOrNull(statement.total)).toBe(209351n);
    expect(fromDbDecimalOrNull(statement.minimumPayment)).toBe(31403n);
    expect(statement.charges.map((c) => [c.kind, fromDbDecimal(c.amount)])).toEqual([
      ["IOF", 1351n],
      ["REMUNERATIVE_INTEREST", 3000n],
    ]);
    // As 10 compras da fatura apontam para ela: 8 novas, a do Meu Pluggy e a do OFX
    const linked = await prisma.transaction.count({ where: { statementId: statement.id } });
    expect(linked).toBe(10);
    const file = await prisma.fileImport.findUniqueOrThrow({ where: { id: firstId } });
    expect(file).toMatchObject({
      kind: "PDF",
      profile: "Banco Exemplo",
      statementId: statement.id,
    });
    expect(fromDbDecimalOrNull(file.invoiceDifference)).toBe(0n);
  });

  it("o histórico diz que é PDF e que a fatura conferiu", async () => {
    const list = await listFileImports(prisma, await authorizeScope(prisma, h.holder.id, "view"));
    expect(list.find((f) => f.id === firstId)).toMatchObject({
      format: "PDF",
      invoice: { difference: 0n },
    });
  });

  it("o mesmo PDF de novo: nada em dobro, a fatura continua uma só", async () => {
    const again = await importInto(h, invoice, later(120_000));
    expect(again).toMatchObject({ created: 0, alreadyImported: 9, pluggy: 1 });
    expect(await prisma.cardStatement.count({ where: { accountId: h.card.id } })).toBe(1);
    expect(await prisma.statementCharge.count({ where: { accountId: h.card.id } })).toBe(2);
  });

  it("o OFX depois do PDF: a mesma compra é 'já importado'", async () => {
    const ofx: StatementFile = {
      ...invoice,
      format: "OFX",
      invoice: null,
      profile: null,
      transactions: [
        {
          externalId: "OFX-FARMACIA",
          occurredOn: "2026-10-18",
          description: "FARMACIA CENTRAL",
          amount: -4790n,
          paymentHint: null,
          installment: null,
        },
      ],
    };
    const result = await importInto(h, ofx, later(180_000));
    expect(result).toMatchObject({ created: 0, alreadyImported: 1, statementId: null });
  });
});

describe("a fatura que o Meu Pluggy já trouxe vale mais", () => {
  let h: TestHousehold;
  let bankStatementId: string;
  beforeAll(async () => {
    h = await createTestHousehold();
    const statement = await prisma.cardStatement.create({
      data: {
        accountId: h.card.id,
        referenceMonth: day("2026-11-01"),
        closingDate: day("2026-11-03"),
        dueDate: day("2026-11-10"),
        total: "2093.51",
        status: "CLOSED",
        source: "OPEN_FINANCE",
        externalId: "bill-1",
      },
    });
    await prisma.statementCharge.create({
      data: { statementId: statement.id, accountId: h.card.id, kind: "IOF", amount: "13.51" },
    });
    bankStatementId = statement.id;
  });
  afterAll(async () => {
    await deleteTestHousehold(h);
  });

  it("o PDF liga as compras à fatura do banco e não troca total nem encargos", async () => {
    const result = await importInto(h, invoice);
    expect(result.statementId).toBe(bankStatementId);
    const statement = await prisma.cardStatement.findUniqueOrThrow({
      where: { id: bankStatementId },
      include: { charges: true },
    });
    expect(statement).toMatchObject({ source: "OPEN_FINANCE", externalId: "bill-1" });
    expect(statement.charges).toHaveLength(1);
    expect(await prisma.transaction.count({ where: { statementId: bankStatementId } })).toBe(10);
  });
});

describe("a fatura que não confere", () => {
  let h: TestHousehold;
  beforeAll(async () => {
    h = await createTestHousehold();
  });
  afterAll(async () => {
    await deleteTestHousehold(h);
  });

  it("a diferença aparece na conferência e fica guardada no arquivo", async () => {
    const off: StatementFile = {
      ...invoice,
      invoice: { ...invoice.invoice!, total: invoice.invoice!.total + 1240n },
    };
    const { id } = await preview(h.holder.id, off);
    const p = await filePreviewFor(prisma, h.holder.id, id, NOW);
    expect(p!.invoice).toMatchObject({ difference: 1240n, matches: false });
    await importFilePreview(
      prisma,
      { grant: await grantFor(h.holder.id, h.card.id), importId: id, now: NOW },
      TEST_CTX,
    );
    const file = await prisma.fileImport.findUniqueOrThrow({ where: { id } });
    expect(fromDbDecimalOrNull(file.invoiceDifference)).toBe(1240n);
  });

  it("fatura em PDF não entra em conta corrente", async () => {
    const { id } = await preview(h.holder.id, invoice);
    const error = await importFilePreview(
      prisma,
      { grant: await grantFor(h.holder.id, h.checking.id), importId: id, now: NOW },
      TEST_CTX,
    ).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe("FILE_ACCOUNT_KIND_MISMATCH");
  });
});
