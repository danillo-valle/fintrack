import { describe, expect, it } from "vitest";
import { AUTOMATIC_SOURCES, SUGGESTION_SOURCES } from "./categorization";
import {
  categoryNameKey,
  inLocalAiWindow,
  isProposalName,
  LOCAL_AI_BULK_SOURCES,
  localAiNightStart,
  localAiWindowEnd,
  saoPauloClock,
} from "./local-ai";

// 2026-10-17 é um sábado; São Paulo está em UTC-3 (sem horário de verão desde 2019)
const sp = (hhmm: string, day = "2026-10-17") => new Date(`${day}T${hhmm}:00-03:00`);

describe("o relógio de São Paulo", () => {
  it("lê a hora local mesmo com o servidor em UTC", () => {
    expect(saoPauloClock(new Date("2026-10-17T07:50:30Z"))).toEqual({
      hour: 4,
      minute: 50,
      second: 30,
    });
  });

  it.each([
    ["04:44", false],
    ["04:45", true],
    ["05:30", true],
    ["06:39", true],
    ["06:40", false],
    ["12:00", false],
    ["23:59", false],
  ])("às %s, janela da IA = %s", (hhmm, dentro) => {
    expect(inLocalAiWindow(sp(hhmm))).toBe(dentro);
  });

  it("a noite que o teto conta começa às 04:00 (de hoje, ou de ontem antes disso)", () => {
    expect(localAiNightStart(sp("05:10")).toISOString()).toBe(sp("04:00").toISOString());
    expect(localAiNightStart(sp("04:00")).toISOString()).toBe(sp("04:00").toISOString());
    expect(localAiNightStart(sp("03:59")).toISOString()).toBe(
      sp("04:00", "2026-10-16").toISOString(),
    );
    expect(localAiNightStart(sp("22:00")).toISOString()).toBe(sp("04:00").toISOString());
  });

  it("a rodada da fila para às 06:40 de hoje", () => {
    expect(localAiWindowEnd(sp("04:50")).toISOString()).toBe(sp("06:40").toISOString());
    expect(localAiWindowEnd(new Date("2026-10-17T08:10:30.500Z")).toISOString()).toBe(
      sp("06:40").toISOString(),
    );
  });
});

describe("o que a IA pode ver", () => {
  it("só as cargas do banco; o lançamento manual nunca", () => {
    expect(LOCAL_AI_BULK_SOURCES).toEqual(["OPEN_FINANCE", "OFX", "PDF"]);
    expect(LOCAL_AI_BULK_SOURCES).not.toContain("MANUAL");
  });

  it("a IA é automática (não vota nem treina enquanto ninguém confirmar), mas não é da cascata", () => {
    expect(AUTOMATIC_SOURCES).toContain("LLM");
    expect(SUGGESTION_SOURCES).not.toContain("LLM");
  });
});

describe("o nome de uma categoria nova", () => {
  it.each([
    ["Academia", true],
    ["Material escolar", true],
    ["Saúde do pet", true],
    ["Pão", true],
    ["A", false],
    ["Um dois três quatro", false],
    ["Ligue 0800", false],
    ["www.site.com", false],
    ["Academia ", false],
    ["Academia  Fit", false],
    ["Responda: Pets", false],
    ["Aaaaaaaaaaaaaaa Bbbbbbbbbbbbbbb", false], // 31 caracteres
  ])("%s → %s", (nome, valido) => {
    expect(isProposalName(nome)).toBe(valido);
  });

  it("compara sem acento e sem diferença de maiúscula", () => {
    expect(categoryNameKey("Farmácia")).toBe(categoryNameKey("farmacia"));
    expect(categoryNameKey("Material  Escolar")).toBe("material escolar");
  });
});
