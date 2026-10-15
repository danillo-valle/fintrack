// A conversão da resposta do serviço Python (gravada a partir da fatura SINTÉTICA de
// samples/pdf; o test_contrato.py do serviço confere que ela é o que o leitor produz) e o
// cliente com um fetch falso. Nenhum PDF real.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { invoiceFromService, isPdfError, readInvoice, sniffPdf, type PdfFetch } from "./invoice";

const RECORDED = JSON.parse(
  readFileSync(new URL("../../fixtures/pdf/exemplo-visa-0002.json", import.meta.url), "utf8"),
) as Record<string, unknown>;
const PDF = new TextEncoder().encode("%PDF-1.7 sintético");

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "nenhum";
  } catch (error) {
    return isPdfError(error) ? error.code : "OUTRO";
  }
}

describe("invoiceFromService", () => {
  const statement = invoiceFromService(RECORDED);

  it("a fatura: vencimento, total, mínimo e encargos em centavos exatos", () => {
    expect(statement).toMatchObject({
      format: "PDF",
      kind: "CREDIT_CARD",
      institution: "Banco Exemplo",
      lastFour: "0002",
      profile: "Banco Exemplo",
      period: { from: "2026-10-01", to: "2026-10-28" },
      skipped: 1,
      invoice: {
        dueDate: "2026-11-10",
        closingDate: "2026-11-01",
        total: 209351n,
        minimum: 31403n,
        charges: [
          { kind: "IOF", amount: 1351n },
          { kind: "REMUNERATIVE_INTEREST", amount: 3000n },
        ],
      },
    });
  });

  it("as compras: sinal do FinTrack, parcela pela descrição, ids estáveis", () => {
    expect(statement.transactions).toHaveLength(10);
    const livraria = statement.transactions.find((t) => t.description.startsWith("LIVRARIA"));
    expect(livraria).toMatchObject({ amount: -19990n, installment: { number: 4, count: 6 } });
    const ids = statement.transactions.map((t) => t.externalId);
    expect(new Set(ids).size).toBe(10);
    expect(ids.every((id) => /^p:[0-9a-f]{32}$/.test(id))).toBe(true);
    expect(invoiceFromService(RECORDED).transactions.map((t) => t.externalId)).toEqual(ids);
  });

  it("compras + encargos = total, ao centavo", () => {
    const purchases = statement.transactions.reduce((sum, t) => sum - t.amount, 0n);
    const charges = statement.invoice!.charges.reduce((sum, c) => sum + c.amount, 0n);
    expect(purchases + charges).toBe(statement.invoice!.total);
  });

  it("duas linhas iguais ganham ids diferentes", () => {
    const row = { occurredOn: "2026-10-05", description: "CAFE", amount: "-5.00" };
    const twice = invoiceFromService({ ...RECORDED, transactions: [row, row] });
    const [a, b] = twice.transactions.map((t) => t.externalId);
    expect(a).not.toBe(b);
  });

  it("resposta fora do formato: PDF_BAD_DATA", () => {
    for (const broken of [
      null,
      { ...RECORDED, transactions: "x" },
      { ...RECORDED, total: 12.5 },
      { ...RECORDED, dueDate: "10/11/2026" },
      { ...RECORDED, charges: [{ kind: "TAXA_INVENTADA", amount: "1.00" }] },
    ]) {
      expect(() => invoiceFromService(broken)).toThrow("PDF_BAD_DATA");
    }
  });
});

describe("readInvoice", () => {
  const reply =
    (status: number, body: unknown): PdfFetch =>
    async () => ({ status, text: async () => JSON.stringify(body) });

  it("manda o token e a senha em base64url, e devolve a fatura", async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null;
    const fetch: PdfFetch = async (url, init) => {
      seen = { url, headers: init.headers };
      return { status: 200, text: async () => JSON.stringify(RECORDED) };
    };
    const statement = await readInvoice(PDF, {
      baseUrl: "http://ml:8000/",
      token: "tok",
      password: "sênha",
      fetch,
    });
    expect(statement.invoice?.total).toBe(209351n);
    expect(seen!.url).toBe("http://ml:8000/v1/faturas");
    expect(seen!.headers.authorization).toBe("Bearer tok");
    expect(Buffer.from(seen!.headers["x-pdf-password"]!, "base64url").toString()).toBe("sênha");
  });

  it("sem senha, não manda o cabeçalho", async () => {
    let headers: Record<string, string> = {};
    await readInvoice(PDF, {
      baseUrl: "http://ml:8000",
      token: "t",
      fetch: async (_u, init) => {
        headers = init.headers;
        return { status: 200, text: async () => JSON.stringify(RECORDED) };
      },
    });
    expect(headers).not.toHaveProperty("x-pdf-password");
  });

  it("os erros viram códigos", async () => {
    const base = { baseUrl: "http://ml:8000", token: "t" };
    expect(await codeOf(readInvoice(PDF, { ...base, baseUrl: undefined }))).toBe(
      "PDF_SERVICE_NOT_CONFIGURED",
    );
    expect(await codeOf(readInvoice(new Uint8Array([1, 2]), base))).toBe("PDF_NOT_RECOGNIZED");
    expect(
      await codeOf(
        readInvoice(PDF, { ...base, fetch: reply(422, { code: "PDF_PASSWORD_REQUIRED" }) }),
      ),
    ).toBe("PDF_PASSWORD_REQUIRED");
    expect(
      await codeOf(readInvoice(PDF, { ...base, fetch: reply(422, { code: "QUALQUER" }) })),
    ).toBe("PDF_NOT_RECOGNIZED");
    expect(await codeOf(readInvoice(PDF, { ...base, fetch: reply(401, {}) }))).toBe(
      "PDF_SERVICE_REJECTED",
    );
    expect(await codeOf(readInvoice(PDF, { ...base, fetch: reply(503, {}) }))).toBe(
      "PDF_SERVICE_UNAVAILABLE",
    );
    const down: PdfFetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    expect(await codeOf(readInvoice(PDF, { ...base, fetch: down }))).toBe(
      "PDF_SERVICE_UNAVAILABLE",
    );
    expect(await codeOf(readInvoice(PDF, { ...base, baseUrl: "file:///etc" }))).toBe("OUTRO");
  });

  it("é PDF pelo começo do arquivo", () => {
    expect(sniffPdf(PDF)).toBe(true);
    expect(sniffPdf(new TextEncoder().encode("OFXHEADER:100"))).toBe(false);
    expect(sniffPdf(new Uint8Array())).toBe(false);
  });
});
