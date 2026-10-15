// Importar extrato (M09.3): o arquivo OFX lido vira Recebidos, sem duplicar o que já veio pelo
// Meu Pluggy nem o que já entrou por outro arquivo; a conferência é de quem enviou e vence em 1
// hora; o portador de um adicional não importa a fatura inteira; e as regras novas do banco.
// Arquivos SINTÉTICOS de samples/ofx/ (escritos à mão); nenhum extrato real.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileFingerprint, parseOfx, type OfxStatement } from "@fintrack/importers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authorizeAccountUse,
  authorizeScope,
  cancelFilePreview,
  createFilePreview,
  DomainError,
  fileImportFor,
  filePreviewFor,
  FILE_PREVIEW_MS,
  importFilePreview,
  listFileImports,
  purgeExpiredPreviews,
  classifyPreviewRows,
  type AccountGrant,
} from "../index";
import {
  auditActions,
  createTestHousehold,
  dbError,
  deleteTestHousehold,
  prisma,
  TEST_CTX,
  FILE_IMPORT_CLOCK,
  type TestHousehold,
} from "./fixtures";

const SAMPLES = new URL("../../../../samples/ofx/", import.meta.url);
const auroraBytes = readFileSync(new URL("aurora-conta-4321.ofx", SAMPLES));
const visaBytes = readFileSync(new URL("exemplo-visa-0002.ofx", SAMPLES));
const aurora = parseOfx(auroraBytes);
const visa = parseOfx(visaBytes);

// A janela deste arquivo no relógio comum (fixtures.ts, FILE_IMPORT_CLOCK)
const NOW = FILE_IMPORT_CLOCK.ofx;
const later = (ms: number) => new Date(NOW.getTime() + ms);
const day = (d: string) => new Date(`${d}T00:00:00Z`);

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(error instanceof DomainError))
    throw new Error(`esperava DomainError, veio ${String(error)}`);
  return error.code;
}

async function grantFor(userId: string, accountId: string): Promise<AccountGrant> {
  const access = await authorizeAccountUse(prisma, userId, accountId);
  if (!access.ok) throw new Error(access.reason);
  return access.grant;
}

async function preview(
  userId: string,
  statement: OfxStatement,
  bytes: Uint8Array,
  now = NOW,
  fileName = "extrato.ofx",
) {
  return createFilePreview(prisma, {
    scope: await authorizeScope(prisma, userId, "edit"),
    fileName,
    sha256: fileFingerprint(bytes),
    statement,
    now,
  });
}

/** Um recebido do Meu Pluggy na conta corrente (como a busca grava). */
function fromPluggy(h: TestHousehold, amount: string, occurredOn: string, description: string) {
  return prisma.transaction.create({
    data: {
      householdId: h.householdId,
      walletId: h.holderWallet.id,
      accountId: h.checking.id,
      method: "DEBIT",
      amount,
      occurredOn: day(occurredOn),
      description,
      status: "PENDING",
      source: "OPEN_FINANCE",
      externalId: `pluggy-${randomUUID()}`,
    },
  });
}

describe("regras novas do banco (M09.3)", () => {
  let h: TestHousehold;
  beforeAll(async () => {
    h = await createTestHousehold();
  });
  afterAll(async () => {
    await deleteTestHousehold(h);
  });

  const base = () => ({
    householdId: h.householdId,
    userId: h.holder.id,
    kind: "OFX" as const,
    sha256: "a".repeat(64),
    fileName: "extrato.ofx",
    statementKind: "BANK" as const,
    rowCount: 1,
    expiresAt: later(FILE_PREVIEW_MS),
  });

  it("impressão digital: SHA-256 em hexadecimal", async () => {
    const error = await dbError(
      prisma.fileImport.create({ data: { ...base(), sha256: "Z".repeat(64) } }),
    );
    expect(error).toContain("file_import_sha256_check");
  });

  it("nome do arquivo de 1 a 120 caracteres", async () => {
    const error = await dbError(prisma.fileImport.create({ data: { ...base(), fileName: "" } }));
    expect(error).toContain("file_import_file_name_check");
  });

  it("da conta, só os 4 últimos dígitos", async () => {
    const error = await dbError(
      prisma.fileImport.create({ data: { ...base(), accountLastFour: "12a4" } }),
    );
    expect(error).toContain("file_import_last_four_check");
  });

  it("contagens nunca negativas", async () => {
    const error = await dbError(prisma.fileImport.create({ data: { ...base(), rowCount: -1 } }));
    expect(error).toContain("file_import_counts_check");
  });

  it("importado tem conta e data e não guarda as linhas", async () => {
    const noAccount = await dbError(
      prisma.fileImport.create({ data: { ...base(), status: "IMPORTED", importedAt: NOW } }),
    );
    expect(noAccount).toContain("file_import_status_check");
    const withRows = await dbError(
      prisma.fileImport.create({
        data: {
          ...base(),
          status: "IMPORTED",
          importedAt: NOW,
          accountId: h.checking.id,
          preview: { rows: [] },
        },
      }),
    );
    expect(withRows).toContain("file_import_status_check");
  });

  it("período com as duas pontas em ordem", async () => {
    const error = await dbError(
      prisma.fileImport.create({
        data: { ...base(), periodFrom: day("2026-10-10"), periodTo: day("2026-10-01") },
      }),
    );
    expect(error).toContain("file_import_period_check");
  });

  it("só lançamento de origem OFX aponta para o arquivo", async () => {
    const file = await prisma.fileImport.create({ data: base(), select: { id: true } });
    const error = await dbError(
      prisma.transaction.create({
        data: {
          householdId: h.householdId,
          walletId: h.holderWallet.id,
          accountId: h.checking.id,
          method: "DEBIT",
          amount: "-1.00",
          occurredOn: day("2026-10-01"),
          description: "Teste",
          source: "MANUAL",
          fileImportId: file.id,
        },
      }),
    );
    expect(error).toContain("transaction_file_import_check");
  });
});

describe("extrato da conta: conferir, importar e não duplicar", () => {
  let h: TestHousehold;
  beforeAll(async () => {
    h = await createTestHousehold();
    // A conta corrente já recebe do Meu Pluggy: 4 linhas do arquivo já vieram por ele
    await fromPluggy(h, "-2146.35", "2026-10-03", "PAGAMENTO FATURA CARTAO");
    await fromPluggy(h, "-189.90", "2026-10-04", "BOLETO ENERGIA");
    await fromPluggy(h, "8450.00", "2026-10-05", "SALARIO EMPRESA EXEMPLO");
    await fromPluggy(h, "-120.00", "2026-10-07", "PIX ENVIADO FULANA");
    // Apagado não conta: este café igual ao do arquivo NÃO esconde a linha
    const gone = await fromPluggy(h, "-12.50", "2026-10-01", "CAFE DA PRACA");
    await prisma.transaction.update({ where: { id: gone.id }, data: { deletedAt: NOW } });
  });
  afterAll(async () => {
    await deleteTestHousehold(h);
  });

  let firstId: string;

  it("a conferência: resumo, a conta sugerida e o estado de cada linha", async () => {
    firstId = (await preview(h.holder.id, aurora, auroraBytes, NOW, "C:\\baixados\\aurora.ofx")).id;
    const p = await filePreviewFor(prisma, h.holder.id, firstId, NOW);
    expect(p).toMatchObject({
      fileName: "aurora.ofx",
      statementKind: "BANK",
      institution: "Banco Aurora",
      lastFour: "4321",
      period: { from: "2026-09-26", to: "2026-10-10" },
      balance: { amount: 421836n, on: "2026-10-10" },
      alreadyImported: null,
      // Corrente e poupança do titular; o vale (da parceira) e o cartão ficam de fora
      accounts: [{ id: h.checking.id, kind: "CHECKING" }],
      suggestion: { accountId: h.checking.id, reason: "ONLY_ONE" },
    });
    expect(p!.rows).toHaveLength(11);
    const states = await classifyPreviewRows(prisma, h.checking.id, p!.rows);
    expect(states.filter((s) => s === "PLUGGY")).toHaveLength(4);
    expect(states.filter((s) => s === "NEW")).toHaveLength(7);
  });

  it("a conferência é só de quem enviou", async () => {
    expect(await filePreviewFor(prisma, h.partner.id, firstId, NOW)).toBeNull();
    expect(await filePreviewFor(prisma, h.holder.id, "nao-e-uuid", NOW)).toBeNull();
    expect(await cancelFilePreview(prisma, h.partner.id, firstId)).toBe(false);
  });

  it("importar: só as novas entram, como Recebidos de origem OFX", async () => {
    const result = await importFilePreview(
      prisma,
      { grant: await grantFor(h.holder.id, h.checking.id), importId: firstId, now: later(60_000) },
      TEST_CTX,
    );
    expect(result).toMatchObject({ created: 7, pluggy: 4, alreadyImported: 0, skipped: 0 });
    const rows = await prisma.transaction.findMany({
      where: { fileImportId: firstId },
      select: {
        status: true,
        source: true,
        walletId: true,
        method: true,
        description: true,
        cardId: true,
        providerCardLastFour: true,
      },
    });
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(row).toMatchObject({
        status: "PENDING",
        source: "OFX",
        walletId: h.holderWallet.id,
        cardId: null,
        providerCardLastFour: null,
      });
    }
    const method = (d: string) => rows.find((r) => r.description === d)?.method;
    expect(method("PIX RECEBIDO CICLANO & CIA")).toBe("PIX");
    expect(method("ENVIO PARA POUPANCA")).toBe("TRANSFER");
    expect(method("PADARIA SÃO JOÃO")).toBe("DEBIT");
    expect(rows.filter((r) => r.description === "CAFE DA PRACA")).toHaveLength(2);

    const file = await prisma.fileImport.findUniqueOrThrow({ where: { id: firstId } });
    expect(file).toMatchObject({
      status: "IMPORTED",
      accountId: h.checking.id,
      preview: null,
      createdCount: 7,
      pluggyCount: 4,
    });
    expect(await auditActions(h.householdId)).toContain("file.imported");
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { householdId: h.householdId, action: "file.imported" },
    });
    expect(JSON.stringify(audit.metadata)).not.toMatch(/aurora|4321|PADARIA/i);
  });

  it("importar de novo a mesma conferência: recusado", async () => {
    const code = await codeOf(
      importFilePreview(
        prisma,
        { grant: await grantFor(h.holder.id, h.checking.id), importId: firstId, now: later(1) },
        TEST_CTX,
      ),
    );
    expect(code).toBe("FILE_PREVIEW_EXPIRED");
  });

  it("o mesmo arquivo de novo: o aviso, a conta aprendida e zero novos", async () => {
    const { id } = await preview(h.holder.id, aurora, auroraBytes, later(120_000));
    const p = await filePreviewFor(prisma, h.holder.id, id, later(120_000));
    expect(p!.alreadyImported).toMatchObject({ accountName: "Conta" });
    expect(p!.suggestion).toEqual({ accountId: h.checking.id, reason: "LEARNED" });
    const result = await importFilePreview(
      prisma,
      { grant: await grantFor(h.holder.id, h.checking.id), importId: id, now: later(130_000) },
      TEST_CTX,
    );
    expect(result).toMatchObject({ created: 0, pluggy: 4, alreadyImported: 7 });
  });

  it("duas abas apertando Importar: um sucesso e uma recusa, nada em dobro", async () => {
    // Um arquivo com uma linha nova (outro dia), para haver o que gravar
    const extra = {
      ...aurora,
      transactions: [
        {
          externalId: "AUR-1010-01",
          occurredOn: "2026-10-10",
          description: "BANCA DE JORNAL",
          amount: -900n,
          paymentHint: null,
          installment: null,
        },
      ],
    };
    const { id } = await preview(h.holder.id, extra, new Uint8Array([1, 2, 3]), later(200_000));
    const grant = await grantFor(h.holder.id, h.checking.id);
    const results = await Promise.allSettled([
      importFilePreview(prisma, { grant, importId: id, now: later(201_000) }, TEST_CTX),
      importFilePreview(prisma, { grant, importId: id, now: later(201_000) }, TEST_CTX),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect((rejected?.reason as DomainError).code).toBe("FILE_PREVIEW_EXPIRED");
    const count = await prisma.transaction.count({
      where: { accountId: h.checking.id, externalId: "AUR-1010-01" },
    });
    expect(count).toBe(1);
  });

  it("o histórico: quem vê a conta vê o arquivo; quem não vê, não", async () => {
    const holderList = await listFileImports(
      prisma,
      await authorizeScope(prisma, h.holder.id, "view"),
    );
    expect(holderList.map((f) => f.id)).toContain(firstId);
    expect(holderList.find((f) => f.id === firstId)).toMatchObject({
      fileName: "aurora.ofx",
      accountName: "Conta",
      lastFour: "4321",
      created: 7,
      pluggy: 4,
    });
    const partnerScope = await authorizeScope(prisma, h.partner.id, "view");
    expect(await listFileImports(prisma, partnerScope)).toEqual([]);
    expect(await fileImportFor(prisma, partnerScope, firstId)).toBeNull();
  });

  it("cancelar apaga a conferência; vencida some na próxima limpeza", async () => {
    const { id } = await preview(h.holder.id, aurora, auroraBytes, later(300_000));
    expect(await cancelFilePreview(prisma, h.holder.id, id)).toBe(true);
    expect(await prisma.fileImport.count({ where: { id } })).toBe(0);

    const old = await preview(h.holder.id, aurora, auroraBytes, later(400_000));
    const expired = later(400_000 + FILE_PREVIEW_MS + 1);
    expect(await filePreviewFor(prisma, h.holder.id, old.id, expired)).toBeNull();
    expect(await purgeExpiredPreviews(prisma, expired)).toBeGreaterThanOrEqual(1);
    expect(await prisma.fileImport.count({ where: { id: old.id } })).toBe(0);
  });
});

describe("fatura do cartão: o final, o tipo de conta e o adicional", () => {
  let h: TestHousehold;
  beforeAll(async () => {
    h = await createTestHousehold();
  });
  afterAll(async () => {
    await deleteTestHousehold(h);
  });

  it("extrato de cartão não entra em conta corrente", async () => {
    const { id } = await preview(h.holder.id, visa, visaBytes);
    const code = await codeOf(
      importFilePreview(
        prisma,
        { grant: await grantFor(h.holder.id, h.checking.id), importId: id, now: NOW },
        TEST_CTX,
      ),
    );
    expect(code).toBe("FILE_ACCOUNT_KIND_MISMATCH");
  });

  it("o portador do adicional não importa a fatura inteira", async () => {
    const { id } = await preview(h.partner.id, visa, visaBytes);
    const p = await filePreviewFor(prisma, h.partner.id, id, NOW);
    expect(p!.accounts).toEqual([]); // o cartão chega a ela só pelo adicional
    const code = await codeOf(
      importFilePreview(
        prisma,
        { grant: await grantFor(h.partner.id, h.card.id), importId: id, now: NOW },
        TEST_CTX,
      ),
    );
    expect(code).toBe("NOT_FOUND");
  });

  it("final que não está cadastrado: sem cartão, com o final guardado; parcela e pagamento", async () => {
    const { id } = await preview(h.holder.id, visa, visaBytes);
    const p = await filePreviewFor(prisma, h.holder.id, id, NOW);
    expect(p).toMatchObject({
      statementKind: "CREDIT_CARD",
      lastFour: "0002",
      skipped: 1,
      suggestion: { accountId: h.card.id, reason: "ONLY_ONE" },
    });
    const result = await importFilePreview(
      prisma,
      { grant: await grantFor(h.holder.id, h.card.id), importId: id, now: NOW },
      TEST_CTX,
    );
    expect(result).toMatchObject({ created: 6, skipped: 1 });
    const rows = await prisma.transaction.findMany({
      where: { fileImportId: id },
      select: {
        cardId: true,
        method: true,
        providerCardLastFour: true,
        description: true,
        providerInstallmentNumber: true,
        providerInstallmentCount: true,
      },
    });
    expect(rows.every((r) => r.cardId === null && r.providerCardLastFour === "0002")).toBe(true);
    expect(rows.every((r) => r.method === "CREDIT")).toBe(true);
    expect(rows.find((r) => r.description.startsWith("LIVRARIA"))).toMatchObject({
      providerInstallmentNumber: 3,
      providerInstallmentCount: 6,
    });
  });

  it("final cadastrado: o cartão certo, pelo final do arquivo", async () => {
    const withCard = {
      ...visa,
      lastFour: "1111",
      transactions: visa.transactions.map((t) => ({ ...t, externalId: `${t.externalId}-b` })),
    };
    const { id } = await preview(h.holder.id, withCard, new Uint8Array([9]));
    const p = await filePreviewFor(prisma, h.holder.id, id, NOW);
    expect(p!.suggestion).toEqual({ accountId: h.card.id, reason: "CARD_LAST_FOUR" });
    await importFilePreview(
      prisma,
      { grant: await grantFor(h.holder.id, h.card.id), importId: id, now: NOW },
      TEST_CTX,
    );
    const cards = await prisma.transaction.findMany({
      where: { fileImportId: id },
      select: { cardId: true, providerCardLastFour: true },
    });
    expect(cards.every((c) => c.cardId === h.holderCard.id)).toBe(true);
    expect(cards.every((c) => c.providerCardLastFour === "1111")).toBe(true);
  });
});
