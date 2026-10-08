// A matriz de papéis, linha por linha. A tabela EXPECTED abaixo é escrita à mão, de propósito:
// se alguém mudar WALLET_MATRIX sem querer, este teste falha e obriga a decidir de novo.
// Cada linha vira um teste com nome legível ("VIEWER · edit · SHARED → nega (ROLE)").
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  canInHousehold,
  canInWallet,
  checkMembershipChange,
  HOUSEHOLD_ACTIONS,
  HOUSEHOLD_ROLES,
  INVITE_TTL_MS,
  inviteStatus,
  normalizeEmail,
  WALLET_ACTIONS,
  WALLET_ROLES,
  type HouseholdAction,
  type HouseholdRole,
  type WalletAction,
  type WalletKind,
  type WalletRole,
} from "./access";

// ✓ = permite; o texto = nega, com o motivo esperado
type Cell = "✓" | "ROLE" | "PERSONAL_WALLET";
const EXPECTED: Record<WalletAction, Record<WalletKind, Record<WalletRole, Cell>>> = {
  //               PESSOAL (só o dono existe nela)          COMPARTILHADA
  view: {
    PERSONAL: { OWNER: "✓", EDITOR: "✓", VIEWER: "✓" },
    SHARED: { OWNER: "✓", EDITOR: "✓", VIEWER: "✓" },
  },
  edit: {
    PERSONAL: { OWNER: "✓", EDITOR: "✓", VIEWER: "ROLE" },
    SHARED: { OWNER: "✓", EDITOR: "✓", VIEWER: "ROLE" },
  },
  export: {
    PERSONAL: { OWNER: "✓", EDITOR: "ROLE", VIEWER: "ROLE" },
    SHARED: { OWNER: "✓", EDITOR: "ROLE", VIEWER: "ROLE" },
  },
  rename: {
    PERSONAL: { OWNER: "✓", EDITOR: "ROLE", VIEWER: "ROLE" },
    SHARED: { OWNER: "✓", EDITOR: "ROLE", VIEWER: "ROLE" },
  },
  manage_members: {
    PERSONAL: { OWNER: "PERSONAL_WALLET", EDITOR: "ROLE", VIEWER: "ROLE" },
    SHARED: { OWNER: "✓", EDITOR: "ROLE", VIEWER: "ROLE" },
  },
  archive: {
    PERSONAL: { OWNER: "PERSONAL_WALLET", EDITOR: "ROLE", VIEWER: "ROLE" },
    SHARED: { OWNER: "✓", EDITOR: "ROLE", VIEWER: "ROLE" },
  },
  leave: {
    PERSONAL: { OWNER: "PERSONAL_WALLET", EDITOR: "PERSONAL_WALLET", VIEWER: "PERSONAL_WALLET" },
    SHARED: { OWNER: "✓", EDITOR: "✓", VIEWER: "✓" },
  },
  // M07: contas e cartões; o dono da pessoal também gerencia (não é só da compartilhada)
  manage_accounts: {
    PERSONAL: { OWNER: "✓", EDITOR: "ROLE", VIEWER: "ROLE" },
    SHARED: { OWNER: "✓", EDITOR: "ROLE", VIEWER: "ROLE" },
  },
};

const rows = WALLET_ACTIONS.flatMap((action) =>
  (["PERSONAL", "SHARED"] as const).flatMap((kind) =>
    WALLET_ROLES.map((role) => ({ action, kind, role, cell: EXPECTED[action][kind][role] })),
  ),
);

describe("matriz de papéis da carteira (ativa)", () => {
  it("cobre todas as combinações: 8 ações × 2 tipos × 3 papéis", () => {
    expect(rows).toHaveLength(48);
  });

  it.each(rows)("$role · $action · $kind → $cell", ({ action, kind, role, cell }) => {
    const decision = canInWallet(role, action, { kind, archived: false });
    if (cell === "✓") expect(decision).toEqual({ allowed: true });
    else expect(decision).toEqual({ allowed: false, reason: cell });
  });
});

describe("carteira arquivada", () => {
  it("o dono ainda vê e desarquiva", () => {
    expect(canInWallet("OWNER", "view", { kind: "SHARED", archived: true }).allowed).toBe(true);
    expect(canInWallet("OWNER", "archive", { kind: "SHARED", archived: true }).allowed).toBe(true);
  });

  it.each(["edit", "export", "rename", "manage_members", "leave", "manage_accounts"] as const)(
    "o dono não pode %s enquanto estiver arquivada",
    (action) => {
      expect(canInWallet("OWNER", action, { kind: "SHARED", archived: true })).toEqual({
        allowed: false,
        reason: "ARCHIVED",
      });
    },
  );

  it("o motivo do papel vem antes do motivo do arquivo (mensagem mais útil)", () => {
    expect(canInWallet("VIEWER", "edit", { kind: "SHARED", archived: true })).toEqual({
      allowed: false,
      reason: "ROLE",
    });
  });
});

const HOUSEHOLD_EXPECTED: Record<HouseholdAction, Record<HouseholdRole, boolean>> = {
  view: { OWNER: true, MEMBER: true },
  invite: { OWNER: true, MEMBER: false },
  remove_member: { OWNER: true, MEMBER: false },
  create_wallet: { OWNER: true, MEMBER: true },
  view_activity: { OWNER: true, MEMBER: false },
  manage_categories: { OWNER: true, MEMBER: true },
};

describe("matriz de papéis do lar", () => {
  const householdRows = HOUSEHOLD_ACTIONS.flatMap((action) =>
    HOUSEHOLD_ROLES.map((role) => ({ action, role, allowed: HOUSEHOLD_EXPECTED[action][role] })),
  );

  it("cobre 6 ações × 2 papéis", () => {
    expect(householdRows).toHaveLength(12);
  });

  it.each(householdRows)("$role · $action → $allowed", ({ action, role, allowed }) => {
    expect(canInHousehold(role, action)).toBe(allowed);
  });
});

describe("checkMembershipChange: a carteira nunca fica sem dono", () => {
  const two = [
    { userId: "a", role: "OWNER" as const },
    { userId: "b", role: "EDITOR" as const },
  ];

  it("recusa rebaixar o único dono", () => {
    expect(checkMembershipChange(two, { type: "set_role", userId: "a", role: "EDITOR" })).toBe(
      "LAST_OWNER",
    );
  });

  it("recusa remover o único dono", () => {
    expect(checkMembershipChange(two, { type: "remove", userId: "a" })).toBe("LAST_OWNER");
  });

  it("aceita rebaixar um dono quando há outro", () => {
    const owners = [...two, { userId: "c", role: "OWNER" as const }];
    expect(checkMembershipChange(owners, { type: "set_role", userId: "a", role: "VIEWER" })).toBe(
      null,
    );
  });

  it("aceita confirmar o mesmo papel de dono", () => {
    expect(checkMembershipChange(two, { type: "set_role", userId: "a", role: "OWNER" })).toBe(null);
  });

  it("recusa adicionar quem já participa e mexer em quem não participa", () => {
    expect(checkMembershipChange(two, { type: "add", userId: "b", role: "VIEWER" })).toBe(
      "ALREADY_MEMBER",
    );
    expect(checkMembershipChange(two, { type: "remove", userId: "z" })).toBe("NOT_A_MEMBER");
  });

  // Teste de propriedade: para QUALQUER lista de membros com pelo menos um dono e QUALQUER
  // mudança, se a regra aceitar, o resultado continua com pelo menos um dono.
  it("propriedade: mudança aceita nunca zera os donos", () => {
    const role = fc.constantFrom<WalletRole>("OWNER", "EDITOR", "VIEWER");
    const ids = ["a", "b", "c", "d"];
    const members = fc
      .uniqueArray(fc.constantFrom(...ids), { minLength: 1, maxLength: 4 })
      .chain((users) => fc.tuple(...users.map((userId) => role.map((r) => ({ userId, role: r })))))
      .filter((list) => list.some((m) => m.role === "OWNER"));
    const change = fc.oneof(
      fc.record({ type: fc.constant("add" as const), userId: fc.constantFrom(...ids), role }),
      fc.record({ type: fc.constant("set_role" as const), userId: fc.constantFrom(...ids), role }),
      fc.record({ type: fc.constant("remove" as const), userId: fc.constantFrom(...ids) }),
    );

    fc.assert(
      fc.property(members, change, (list, c) => {
        if (checkMembershipChange(list, c) !== null) return; // recusada: nada a conferir
        let after = list.map((m) => ({ ...m }));
        if (c.type === "add") after.push({ userId: c.userId, role: c.role });
        if (c.type === "remove") after = after.filter((m) => m.userId !== c.userId);
        if (c.type === "set_role")
          after = after.map((m) => (m.userId === c.userId ? { ...m, role: c.role } : m));
        expect(after.some((m) => m.role === "OWNER")).toBe(true);
      }),
    );
  });
});

describe("inviteStatus", () => {
  const created = new Date("2026-10-06T12:00:00Z");
  const expiresAt = new Date(created.getTime() + INVITE_TTL_MS);
  const base = { expiresAt, acceptedAt: null, revokedAt: null };

  it("vale 72 horas", () => {
    expect(INVITE_TTL_MS).toBe(259_200_000);
  });

  it("pendente até um instante antes de expirar; expirado no instante exato", () => {
    expect(inviteStatus(base, new Date(expiresAt.getTime() - 1))).toBe("PENDING");
    expect(inviteStatus(base, expiresAt)).toBe("EXPIRED");
  });

  it("aceito e cancelado não dependem do relógio", () => {
    const later = new Date(expiresAt.getTime() + 1);
    expect(inviteStatus({ ...base, acceptedAt: created }, later)).toBe("ACCEPTED");
    expect(inviteStatus({ ...base, revokedAt: created }, later)).toBe("REVOKED");
  });
});

describe("normalizeEmail", () => {
  it("tira espaços e passa para minúsculas", () => {
    expect(normalizeEmail("  Esposa@Exemplo.COM ")).toBe("esposa@exemplo.com");
  });
});
