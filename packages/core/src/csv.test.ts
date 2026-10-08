// CSV para o Excel em português, com a proteção contra injeção de fórmula (OWASP).
import { describe, expect, it } from "vitest";
import { CSV_BOM, csvMoney, csvText, toCsv } from "./csv";

describe("csvText", () => {
  it.each([
    ["Mercado", "Mercado"],
    ["Pão; leite", '"Pão; leite"'],
    ['Loja "Boa"', '"Loja ""Boa"""'],
    ["linha\nnova", '"linha\nnova"'],
    [" espaço", '" espaço"'],
    [null, ""],
  ])("%j → %j", (input, expected) => {
    expect(csvText(input)).toBe(expected);
  });

  it.each(['=HYPERLINK("http://x")', "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"])(
    "texto que viraria fórmula ganha apóstrofo: %j",
    (danger) => {
      const out = csvText(danger);
      expect(out.replace(/^"/, "").startsWith("'")).toBe(true);
    },
  );
});

describe("csvMoney", () => {
  it("vírgula decimal, sinal, sem milhar", () => {
    expect(csvMoney(-123456n)).toBe("-1234,56");
    expect(csvMoney(5n)).toBe("0,05");
  });
});

describe("toCsv", () => {
  it("BOM, separador ; e CRLF; número negativo NÃO ganha apóstrofo", () => {
    const csv = toCsv(
      ["Data", "Descrição", "Valor"],
      [[{ raw: "2026-10-07" }, { text: "=1+1" }, { raw: csvMoney(-4235n) }]],
    );
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toBe(`${CSV_BOM}Data;Descrição;Valor\r\n2026-10-07;'=1+1;-42,35\r\n`);
  });
});
