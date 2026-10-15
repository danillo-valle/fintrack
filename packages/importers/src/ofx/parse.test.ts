// O leitor de OFX contra os dois arquivos SINTÉTICOS de samples/ofx/ (escritos à mão: Banco
// Aurora conta final 4321 em OFX 1 latin-1, Banco Exemplo Visa final 0002 em OFX 2) e contra
// variações montadas aqui. Nenhum extrato real.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isOfxError, MAX_OFX_BYTES, parseOfx, sniffOfx, stripComments } from "./parse";
import { fileFingerprint } from "../statement-file";

const SAMPLES = new URL("../../../../samples/ofx/", import.meta.url);
const aurora = readFileSync(new URL("aurora-conta-4321.ofx", SAMPLES));
const visa = readFileSync(new URL("exemplo-visa-0002.ofx", SAMPLES));

const latin1 = (text: string) => new Uint8Array(Buffer.from(text, "latin1"));
const utf8 = (text: string) => new TextEncoder().encode(text);

function codeOf(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return isOfxError(error) ? error.code : "OUTRO";
  }
}

/** Um OFX 1 mínimo com as linhas dadas dentro do extrato. */
function sgml(statement: string, header = "OFXHEADER:100\nDATA:OFXSGML\nCHARSET:1252\n\n") {
  return `${header}<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL\n${statement}\n</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
}
const trn = (fields: string) => `<STMTTRN>${fields}</STMTTRN>`;
const list = (rows: string) => `<BANKTRANLIST>${rows}</BANKTRANLIST>`;

describe("os arquivos sintéticos", () => {
  it("só dados sintéticos: bancos inventados e nada parecido com um cartão inteiro", () => {
    for (const [bytes, bank] of [
      [aurora, "Banco Aurora"],
      [visa, "Banco Exemplo"],
    ] as const) {
      const text = Buffer.from(bytes).toString("latin1");
      expect(text).toContain(bank);
      expect(text.replace(/<DT[A-Z]+>[^<\n]*/g, "")).not.toMatch(/\d{13,19}/);
    }
  });
});

describe("parseOfx: extrato da conta (OFX 1, SGML, latin-1)", () => {
  const statement = parseOfx(aurora);

  it("lê a conta só pelo final", () => {
    expect(statement).toMatchObject({
      version: 1,
      kind: "BANK",
      institution: "Banco Aurora",
      bankId: "999",
      lastFour: "4321",
      accountType: "CHECKING",
      period: { from: "2026-09-26", to: "2026-10-10" },
      balance: { amount: 421836n, on: "2026-10-10" },
      skipped: 0,
    });
    expect(
      JSON.stringify(statement, (_k, v: unknown) => (typeof v === "bigint" ? `${v}` : v)),
    ).not.toContain("98765");
  });

  it("acentos do latin-1, vírgula decimal, milhar e &amp;", () => {
    const byDescription = new Map(statement.transactions.map((t) => [t.description, t]));
    expect(byDescription.get("PADARIA SÃO JOÃO")?.amount).toBe(-4590n);
    expect(byDescription.get("FARMÁCIA DO BAIRRO")?.amount).toBe(-8900n);
    expect(byDescription.get("PIX RECEBIDO CICLANO & CIA")).toMatchObject({
      amount: 125000n,
      occurredOn: "2026-10-09",
      paymentHint: "PIX",
    });
  });

  it("forma de pagamento pelo tipo e pela descrição", () => {
    const hint = (d: string) =>
      statement.transactions.find((t) => t.description === d)?.paymentHint;
    expect(hint("ENVIO PARA POUPANCA")).toBe("TRANSFER");
    expect(hint("BOLETO ENERGIA")).toBe("BOLETO");
    expect(hint("CAFE DA PRACA")).toBeNull();
  });

  it("FITID repetido e FITID ausente ganham ids estáveis e diferentes", () => {
    const ids = statement.transactions.map((t) => t.externalId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("AUR-0926-01");
    const cafes = statement.transactions.filter((t) => t.description === "CAFE DA PRACA");
    expect(cafes).toHaveLength(2);
    for (const cafe of cafes) expect(cafe.externalId).toMatch(/^h:[0-9a-f]{32}$/);
    expect(parseOfx(aurora).transactions.map((t) => t.externalId)).toEqual(ids); // de novo, iguais
  });

  it("11 lançamentos, na ordem do arquivo", () => {
    expect(statement.transactions).toHaveLength(11);
    expect(statement.transactions[0]!.occurredOn).toBe("2026-09-26");
  });

  it("CRLF e o BOM do UTF-8 não mudam nada", () => {
    const crlf = Buffer.from(
      Buffer.from(aurora).toString("latin1").replace(/\n/g, "\r\n"),
      "latin1",
    );
    expect(parseOfx(crlf).transactions).toEqual(statement.transactions);
  });
});

describe("parseOfx: fatura do cartão (OFX 2, XML, UTF-8)", () => {
  const statement = parseOfx(visa);

  it("o cartão só pelo final, sem banco e com o saldo devedor", () => {
    expect(statement).toMatchObject({
      version: 2,
      kind: "CREDIT_CARD",
      institution: "Banco Exemplo",
      bankId: null,
      lastFour: "0002",
      accountType: "CREDIT_CARD",
      period: { from: "2026-09-13", to: "2026-10-12" },
      balance: { amount: -32556n, on: "2026-10-12" },
    });
  });

  it("o pagamento da fatura fica de fora; o estorno entra", () => {
    expect(statement.skipped).toBe(1);
    const descriptions = statement.transactions.map((t) => t.description);
    expect(descriptions).not.toContain("PAGAMENTO RECEBIDO");
    expect(descriptions).toContain("ESTORNO RESTAURANTE SABOR");
    expect(statement.transactions).toHaveLength(6);
  });

  it("a parcela pela descrição, e nada de forma de pagamento no cartão", () => {
    const livraria = statement.transactions.find((t) => t.description.startsWith("LIVRARIA"));
    expect(livraria).toMatchObject({ amount: -19990n, installment: { number: 3, count: 6 } });
    expect(statement.transactions.every((t) => t.paymentHint === null)).toBe(true);
  });

  it("o número inteiro do cartão não sai do leitor", () => {
    const full = "9".repeat(12) + "0002";
    const text = Buffer.from(visa)
      .toString("utf8")
      .replace(/<ACCTID>[^<]*<\/ACCTID>/, `<ACCTID>${full}</ACCTID>`);
    const parsed = parseOfx(utf8(text));
    expect(parsed.lastFour).toBe("0002");
    expect(
      JSON.stringify(parsed, (_k, v: unknown) => (typeof v === "bigint" ? `${v}` : v)),
    ).not.toContain("9999");
  });
});

describe("sniffOfx: o tipo pelo conteúdo", () => {
  it("OFX 1, OFX 2 e SGML sem cabeçalho", () => {
    expect(sniffOfx(aurora)).toBe(1);
    expect(sniffOfx(visa)).toBe(2);
    expect(sniffOfx(utf8("﻿  <OFX><BANKMSGSRSV1>"))).toBe(1);
  });

  it("recusa o que não é OFX, mesmo com o nome .ofx", () => {
    expect(sniffOfx(utf8("%PDF-1.7\n"))).toBeNull();
    expect(sniffOfx(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]))).toBeNull(); // zip
    expect(sniffOfx(utf8("data;descricao;valor\n"))).toBeNull();
    expect(sniffOfx(utf8('<?xml version="1.0"?><html></html>'))).toBeNull();
  });
});

describe("parseOfx: o que é recusado", () => {
  it("mais de 2 MB", () => {
    expect(codeOf(() => parseOfx(new Uint8Array(MAX_OFX_BYTES + 1)))).toBe("OFX_TOO_LARGE");
  });

  it("não é OFX", () => {
    expect(codeOf(() => parseOfx(utf8("olá")))).toBe("OFX_NOT_RECOGNIZED");
  });

  it("OFX sem extrato", () => {
    const empty = "OFXHEADER:100\n\n<OFX><SIGNONMSGSRSV1><SONRS></SONRS></SIGNONMSGSRSV1></OFX>";
    expect(codeOf(() => parseOfx(utf8(empty)))).toBe("OFX_NO_STATEMENT");
  });

  it("duas contas no mesmo arquivo", () => {
    const one = "<STMTTRNRS><STMTRS><CURDEF>BRL</STMTRS></STMTTRNRS>";
    const two = `OFXHEADER:100\n\n<OFX><BANKMSGSRSV1>${one}${one}</BANKMSGSRSV1></OFX>`;
    expect(codeOf(() => parseOfx(utf8(two)))).toBe("OFX_MULTIPLE_ACCOUNTS");
  });

  it("extrato em outra moeda", () => {
    const usd = sgml("").replace("<CURDEF>BRL", "<CURDEF>USD");
    expect(codeOf(() => parseOfx(utf8(usd)))).toBe("OFX_NOT_BRL");
  });

  it("data ou valor ilegível", () => {
    const badDate = sgml(list(trn("<DTPOSTED>2026-10-01<TRNAMT>-1.00<FITID>1")));
    const badAmount = sgml(list(trn("<DTPOSTED>20261001<TRNAMT>doze<FITID>1")));
    const badDay = sgml(list(trn("<DTPOSTED>20260231<TRNAMT>-1.00<FITID>1")));
    for (const file of [badDate, badAmount, badDay])
      expect(codeOf(() => parseOfx(latin1(file)))).toBe("OFX_BAD_DATA");
  });

  it("valor que não cabe na coluna (14 dígitos com os centavos)", () => {
    const huge = sgml(list(trn("<DTPOSTED>20261001<TRNAMT>-1000000000000.00<FITID>1")));
    expect(codeOf(() => parseOfx(latin1(huge)))).toBe("OFX_BAD_DATA");
  });

  it("o erro não carrega dado do arquivo", () => {
    expect.assertions(2);
    const bad = sgml(list(trn("<DTPOSTED>20261001<TRNAMT>SEGREDO<FITID>1")));
    try {
      parseOfx(latin1(bad));
    } catch (error) {
      expect(String(error)).not.toContain("SEGREDO");
      expect(isOfxError(error) && error.detail).toBe("lançamento 1: valor");
    }
  });
});

describe("parseOfx: detalhes", () => {
  it("sem DTSTART/DTEND, o período é a primeira e a última data", () => {
    const file = sgml(
      list(
        trn("<DTPOSTED>20261005<TRNAMT>-1.00<FITID>b<NAME>B") +
          trn("<DTPOSTED>20261002<TRNAMT>-2.00<FITID>a<NAME>A"),
      ),
    );
    expect(parseOfx(latin1(file)).period).toEqual({ from: "2026-10-02", to: "2026-10-05" });
  });

  it("linha de valor zero fica de fora e é contada", () => {
    const file = sgml(
      list(
        trn("<DTPOSTED>20261001<TRNAMT>0.00<FITID>a<MEMO>TARIFA ISENTA") +
          trn("<DTPOSTED>20261001<TRNAMT>-3.00<FITID>b<MEMO>CAFE"),
      ),
    );
    const parsed = parseOfx(latin1(file));
    expect(parsed.skipped).toBe(1);
    expect(parsed.transactions.map((t) => t.description)).toEqual(["CAFE"]);
  });

  it("descrição: MEMO, senão NAME, senão o texto padrão", () => {
    const file = sgml(
      list(
        trn("<DTPOSTED>20261001<TRNAMT>-1.00<FITID>a<NAME>SO NOME") +
          trn("<DTPOSTED>20261001<TRNAMT>-1.00<FITID>b"),
      ),
    );
    expect(parseOfx(latin1(file)).transactions.map((t) => t.description)).toEqual([
      "SO NOME",
      "Lançamento do banco",
    ]);
  });

  it("ENCODING:UTF-8 no cabeçalho do OFX 1", () => {
    const file = sgml(
      list(trn("<DTPOSTED>20261001<TRNAMT>-1.00<FITID>a<MEMO>AÇAÍ")),
      "OFXHEADER:100\nENCODING:UTF-8\n\n",
    );
    expect(parseOfx(utf8(file)).transactions[0]!.description).toBe("AÇAÍ");
  });

  it("a impressão digital é o SHA-256 do arquivo", () => {
    expect(fileFingerprint(utf8("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(fileFingerprint(aurora)).not.toBe(fileFingerprint(visa));
  });
});

describe("stripComments: comentários fora, sem expressão regular", () => {
  it("tira um, vários e o que não fecha", () => {
    expect(stripComments("a<!-- x -->b<!--y-->c")).toBe("abc");
    expect(stripComments("a<!-- sem fim <TRNAMT>-1.00")).toBe("a");
    expect(stripComments("sem comentário")).toBe("sem comentário");
  });

  it("o que sobra de uma passada não vira comentário novo", () => {
    expect(stripComments("<!<!--x-->--x-->")).toBe("<!--x-->");
  });

  it("muitos '<!--' seguidos terminam rápido (linear)", () => {
    const evil = "<!--".repeat(200_000);
    const start = performance.now();
    expect(stripComments(evil)).toBe("");
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("entidade fora do Unicode fica como veio", () => {
    const file = sgml(
      list(trn("<DTPOSTED>20261001<TRNAMT>-1.00<FITID>a<MEMO>LOJA &#99999999; &#x41;")),
    );
    expect(parseOfx(latin1(file)).transactions[0]!.description).toBe("LOJA &#99999999; A");
  });

  it("uma tag dentro de comentário não entra no extrato", () => {
    const file = sgml(
      list(
        trn("<DTPOSTED>20261001<TRNAMT>-1.00<FITID>a<MEMO>CAFE") +
          "<!-- <STMTTRN><TRNAMT>-999.00 -->",
      ),
    );
    expect(parseOfx(latin1(file)).transactions.map((t) => t.amount)).toEqual([-100n]);
  });
});
