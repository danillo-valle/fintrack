// Textos das permissões. A completude (todo código de erro e todo evento com frase) já é
// garantida pelo TypeScript (Record<DomainErrorCode, ...>); aqui conferimos o comportamento.
import { describe, expect, it } from "vitest";
import {
  accessDeniedMessage,
  auditActionLabel,
  AUDIT_ACTION_LABEL,
  domainErrorMessage,
  WALLET_ROLE_HELP,
  WALLET_ROLE_LABEL,
} from "./access-messages";

describe("accessDeniedMessage", () => {
  it("NOT_FOUND e motivo desconhecido dão a mesma frase neutra (não confirma que existe)", () => {
    expect(accessDeniedMessage("NOT_FOUND")).toBe(accessDeniedMessage("qualquer coisa"));
    expect(accessDeniedMessage("NOT_FOUND")).not.toMatch(/permiss|papel|existe/i);
  });

  it("explica o papel para quem participa", () => {
    expect(accessDeniedMessage("ROLE")).toMatch(/papel/);
  });
});

describe("domainErrorMessage", () => {
  it("SOLE_WALLET_OWNER cita as carteiras que impedem a remoção", () => {
    expect(domainErrorMessage("SOLE_WALLET_OWNER", { wallets: ["Viagem", "Casa"] })).toContain(
      "Viagem, Casa",
    );
  });

  it("código desconhecido cai na frase neutra", () => {
    expect(domainErrorMessage("XYZ")).toBe(domainErrorMessage("NOT_FOUND"));
  });
});

describe("rótulos", () => {
  it("cada papel tem nome e explicação", () => {
    expect(Object.keys(WALLET_ROLE_LABEL)).toEqual(Object.keys(WALLET_ROLE_HELP));
  });

  it("evento conhecido vira frase; desconhecido aparece como veio", () => {
    expect(auditActionLabel("wallet.renamed")).toBe("renomeou uma carteira");
    expect(auditActionLabel("x.y")).toBe("x.y");
    // 13 eventos do M06 + 14 do M07 + 2 do M07.4 (compras conjuntas e compra parcelada)
    expect(Object.keys(AUDIT_ACTION_LABEL)).toHaveLength(29);
  });
});
