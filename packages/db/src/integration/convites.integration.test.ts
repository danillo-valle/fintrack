// Lar e convites (M06): criar o lar, convidar por link de uso único com prazo, aceitar.
// Cada teste tenta o caminho "malicioso" ou o erro comum: link usado duas vezes, aceito em
// duas abas ao mesmo tempo, aberto por outra conta, expirado, cancelado, de outro lar.
//
// Rode com: pnpm test:integration
import { INVITE_TTL_MS } from "@fintrack/core";
import { afterEach, describe, expect, it } from "vitest";
import { authorizeHousehold, DomainError } from "../access";
import {
  acceptInvite,
  createHousehold,
  createInvite,
  findInviteByToken,
  hashInviteToken,
  listHouseholdActivity,
  removeHouseholdMember,
  revokeInvite,
} from "../households";
import {
  auditActions,
  createLoosePerson,
  dbError,
  deletePeople,
  prisma,
  TEST_CTX,
} from "./fixtures";

// Pessoas e lares criados em cada teste, apagados no fim
const people: string[] = [];
const households: string[] = [];
afterEach(async () => {
  await prisma.household.deleteMany({ where: { id: { in: households.splice(0) } } });
  await deletePeople(people.splice(0));
});

async function person(label: string) {
  const p = await createLoosePerson(label);
  people.push(p.id);
  return p;
}

/** Dona com lar criado e o crachá de convidar. */
async function ownerWithHousehold() {
  const owner = await person("dona");
  const { household, personalWallet } = await createHousehold(
    prisma,
    { user: owner, name: "Casa de Teste" },
    TEST_CTX,
  );
  households.push(household.id);
  const access = await authorizeHousehold(prisma, owner.id, "invite");
  if (!access.ok) throw new Error("a dona deveria poder convidar");
  return { owner, household, personalWallet, grant: access.grant };
}

describe("criar o lar", () => {
  it("cria o lar com a pessoa como dona, a carteira pessoal e a auditoria", async () => {
    const { owner, household, personalWallet } = await ownerWithHousehold();
    const member = await prisma.householdMember.findUniqueOrThrow({
      where: { householdId_userId: { householdId: household.id, userId: owner.id } },
    });
    expect(member.role).toBe("OWNER");
    expect(personalWallet.kind).toBe("PERSONAL");
    expect(personalWallet.name).toBe(owner.name);
    expect(await auditActions(household.id)).toEqual(["household.created", "wallet.created"]);
  });

  it("recusa um segundo lar para a mesma pessoa", async () => {
    const { owner } = await ownerWithHousehold();
    const error = await dbError(createHousehold(prisma, { user: owner, name: "Outro" }, TEST_CTX));
    expect(error).toContain("ALREADY_IN_HOUSEHOLD");
  });

  it("dois cliques ao mesmo tempo criam UM lar só (trava por pessoa)", async () => {
    const owner = await person("pressa");
    const results = await Promise.allSettled([
      createHousehold(prisma, { user: owner, name: "Clique 1" }, TEST_CTX),
      createHousehold(prisma, { user: owner, name: "Clique 2" }, TEST_CTX),
    ]);
    for (const r of results) if (r.status === "fulfilled") households.push(r.value.household.id);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.householdMember.count({ where: { userId: owner.id } })).toBe(1);
  });

  it("o banco recusa nome vazio ou só com espaços (household_name_length_check)", async () => {
    const owner = await person("vazio");
    const error = await dbError(createHousehold(prisma, { user: owner, name: "   " }, TEST_CTX));
    expect(error).toContain("household_name_length_check");
  });
});

describe("convite", () => {
  it("o banco guarda só o hash do segredo, nunca o segredo", async () => {
    const { grant } = await ownerWithHousehold();
    const { invite, token } = await createInvite(
      prisma,
      grant,
      { email: "x@exemplo.test", role: "MEMBER" },
      TEST_CTX,
    );
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(invite.tokenHash).toBe(hashInviteToken(token));
    expect(invite.tokenHash).not.toContain(token);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: invite.id, action: "household.invite_created" },
    });
    // nem o segredo nem o e-mail inteiro vão para a auditoria
    expect(JSON.stringify({ ...audit, id: audit.id.toString() })).not.toContain(token);
    expect(audit.metadata).toMatchObject({ email: "***@exemplo.test", role: "MEMBER" });
  });

  it("normaliza o e-mail e vale 72 horas", async () => {
    const { grant } = await ownerWithHousehold();
    const now = new Date("2026-10-06T12:00:00Z");
    const { invite } = await createInvite(
      prisma,
      grant,
      { email: "  Esposa@Exemplo.TEST ", role: "MEMBER" },
      TEST_CTX,
      now,
    );
    expect(invite.email).toBe("esposa@exemplo.test");
    expect(invite.expiresAt.getTime() - now.getTime()).toBe(INVITE_TTL_MS);
  });

  it("convite novo para o mesmo e-mail cancela o anterior", async () => {
    const { grant } = await ownerWithHousehold();
    const first = await createInvite(
      prisma,
      grant,
      { email: "a@exemplo.test", role: "MEMBER" },
      TEST_CTX,
    );
    await createInvite(prisma, grant, { email: "a@exemplo.test", role: "MEMBER" }, TEST_CTX);
    expect((await findInviteByToken(prisma, first.token))?.status).toBe("REVOKED");
  });

  it("não convida quem já está no lar", async () => {
    const { grant, owner } = await ownerWithHousehold();
    const error = await dbError(
      createInvite(prisma, grant, { email: owner.email.toUpperCase(), role: "MEMBER" }, TEST_CTX),
    );
    expect(error).toContain("ALREADY_MEMBER");
  });

  it("aceitar: entra no lar com o papel do convite e ganha a carteira pessoal", async () => {
    const { grant, household } = await ownerWithHousehold();
    const guest = await person("convidada");
    const { token } = await createInvite(
      prisma,
      grant,
      { email: guest.email, role: "MEMBER" },
      TEST_CTX,
    );

    const accepted = await acceptInvite(prisma, { token, user: guest }, TEST_CTX);

    expect(accepted.householdId).toBe(household.id);
    const member = await prisma.householdMember.findUniqueOrThrow({
      where: { householdId_userId: { householdId: household.id, userId: guest.id } },
    });
    expect(member.role).toBe("MEMBER");
    expect(accepted.personalWallet.kind).toBe("PERSONAL");
    expect(await auditActions(household.id)).toEqual([
      "household.created",
      "wallet.created",
      "household.invite_created",
      "household.invite_accepted",
      "wallet.created",
    ]);
  });

  it("uso único: o mesmo link não funciona duas vezes", async () => {
    const { grant } = await ownerWithHousehold();
    const guest = await person("convidada");
    const { token } = await createInvite(
      prisma,
      grant,
      { email: guest.email, role: "MEMBER" },
      TEST_CTX,
    );
    await acceptInvite(prisma, { token, user: guest }, TEST_CTX);
    const error = await dbError(acceptInvite(prisma, { token, user: guest }, TEST_CTX));
    expect(error).toContain("INVITE_INVALID");
  });

  it("uso único com corrida: duas abas aceitando ao mesmo tempo, só uma entra", async () => {
    const { grant, household } = await ownerWithHousehold();
    const guest = await person("duas-abas");
    const { token } = await createInvite(
      prisma,
      grant,
      { email: guest.email, role: "MEMBER" },
      TEST_CTX,
    );
    const results = await Promise.allSettled([
      acceptInvite(prisma, { token, user: guest }, TEST_CTX),
      acceptInvite(prisma, { token, user: guest }, TEST_CTX),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await prisma.wallet.count({ where: { householdId: household.id, createdById: guest.id } }),
    ).toBe(1);
  });

  it("outra conta não aceita o convite de outro e-mail (mesmo com o link)", async () => {
    const { grant } = await ownerWithHousehold();
    const guest = await person("certa");
    const intruder = await person("intrusa");
    const { token } = await createInvite(
      prisma,
      grant,
      { email: guest.email, role: "MEMBER" },
      TEST_CTX,
    );
    const error = await dbError(acceptInvite(prisma, { token, user: intruder }, TEST_CTX));
    expect(error).toContain("INVITE_WRONG_ACCOUNT");
    // o convite continua valendo para a pessoa certa
    expect((await findInviteByToken(prisma, token))?.status).toBe("PENDING");
  });

  it("aceita com o e-mail da conta em maiúsculas (comparação normalizada)", async () => {
    const { grant } = await ownerWithHousehold();
    const guest = await person("maiuscula");
    const { token } = await createInvite(
      prisma,
      grant,
      { email: guest.email, role: "MEMBER" },
      TEST_CTX,
    );
    await expect(
      acceptInvite(
        prisma,
        { token, user: { ...guest, email: guest.email.toUpperCase() } },
        TEST_CTX,
      ),
    ).resolves.toBeTruthy();
  });

  it("expirado: recusa no instante do prazo", async () => {
    const { grant } = await ownerWithHousehold();
    const guest = await person("atrasada");
    const created = new Date("2026-10-06T12:00:00Z");
    const { token } = await createInvite(
      prisma,
      grant,
      { email: guest.email, role: "MEMBER" },
      TEST_CTX,
      created,
    );
    const deadline = new Date(created.getTime() + INVITE_TTL_MS);
    const error = await dbError(acceptInvite(prisma, { token, user: guest }, TEST_CTX, deadline));
    expect(error).toContain("INVITE_INVALID");
  });

  it("cancelado: recusa; e o cancelamento fica na auditoria", async () => {
    const { grant, household } = await ownerWithHousehold();
    const guest = await person("cancelada");
    const { token, invite } = await createInvite(
      prisma,
      grant,
      { email: guest.email, role: "MEMBER" },
      TEST_CTX,
    );
    await revokeInvite(prisma, grant, invite.id, TEST_CTX);
    const error = await dbError(acceptInvite(prisma, { token, user: guest }, TEST_CTX));
    expect(error).toContain("INVITE_INVALID");
    expect(await auditActions(household.id)).toContain("household.invite_revoked");
  });

  it("IDOR: a dona de outro lar não cancela convite que não é dela", async () => {
    const a = await ownerWithHousehold();
    const b = await ownerWithHousehold();
    const { invite } = await createInvite(
      prisma,
      a.grant,
      { email: "z@exemplo.test", role: "MEMBER" },
      TEST_CTX,
    );
    const error = await dbError(revokeInvite(prisma, b.grant, invite.id, TEST_CTX));
    expect(error).toContain("NOT_FOUND");
  });

  it("segredo fora do formato ou inventado: nada (null), sem consultar com lixo", async () => {
    expect(await findInviteByToken(prisma, "curto")).toBeNull();
    expect(await findInviteByToken(prisma, "A".repeat(43))).toBeNull();
    const error = await dbError(
      acceptInvite(
        prisma,
        { token: "x".repeat(10), user: { id: "u", name: "u", email: "u@x" } },
        TEST_CTX,
      ),
    );
    expect(error).toContain("INVITE_INVALID");
  });

  it("quem já tem lar não aceita convite de outro (um lar por pessoa, por enquanto)", async () => {
    const a = await ownerWithHousehold();
    const b = await ownerWithHousehold();
    const { token } = await createInvite(
      prisma,
      a.grant,
      { email: b.owner.email, role: "MEMBER" },
      TEST_CTX,
    );
    const error = await dbError(acceptInvite(prisma, { token, user: b.owner }, TEST_CTX));
    expect(error).toContain("ALREADY_IN_HOUSEHOLD");
  });
});

describe("regras do banco para o convite (CHECKs da migração)", () => {
  async function insertInvite(overrides: Record<string, unknown>) {
    const { household } = await ownerWithHousehold();
    const now = new Date();
    return prisma.householdInvite.create({
      data: {
        householdId: household.id,
        tokenHash: "a".repeat(64),
        email: "ok@exemplo.test",
        expiresAt: new Date(now.getTime() + 1000),
        createdAt: now,
        ...overrides,
      },
    });
  }

  it("household_invite_token_hash_check: recusa o segredo em texto no lugar do hash", async () => {
    expect(await dbError(insertInvite({ tokenHash: "Z".repeat(64) }))).toContain(
      "household_invite_token_hash_check",
    );
  });

  it("household_invite_email_check: recusa e-mail com maiúscula ou sem @", async () => {
    expect(await dbError(insertInvite({ email: "Ana@exemplo.test" }))).toContain(
      "household_invite_email_check",
    );
    expect(await dbError(insertInvite({ email: "sem-arroba" }))).toContain(
      "household_invite_email_check",
    );
  });

  it("household_invite_expiry_check: prazo antes da criação", async () => {
    expect(await dbError(insertInvite({ expiresAt: new Date(2000, 0, 1) }))).toContain(
      "household_invite_expiry_check",
    );
  });

  it("household_invite_state_check: aceito e cancelado ao mesmo tempo", async () => {
    expect(
      await dbError(insertInvite({ acceptedAt: new Date(), revokedAt: new Date() })),
    ).toContain("household_invite_state_check");
  });

  it("household_invite_acceptor_check: quem aceitou sem data de aceitação", async () => {
    const someone = await person("aceitou");
    expect(await dbError(insertInvite({ acceptedById: someone.id }))).toContain(
      "household_invite_acceptor_check",
    );
  });
});

describe("tirar alguém do lar", () => {
  async function coupleWithSharedWallet(guestRoleInShared: "OWNER" | "EDITOR") {
    const base = await ownerWithHousehold();
    const guest = await person("parceira");
    const { token } = await createInvite(
      prisma,
      base.grant,
      { email: guest.email, role: "MEMBER" },
      TEST_CTX,
    );
    const { personalWallet } = await acceptInvite(prisma, { token, user: guest }, TEST_CTX);
    const shared = await prisma.wallet.create({
      data: {
        householdId: base.household.id,
        name: "Viagem",
        kind: "SHARED",
        members: {
          create: [
            { userId: base.owner.id, role: guestRoleInShared === "OWNER" ? "VIEWER" : "OWNER" },
            { userId: guest.id, role: guestRoleInShared },
          ],
        },
      },
    });
    const access = await authorizeHousehold(prisma, base.owner.id, "remove_member");
    if (!access.ok) throw new Error("a dona deveria poder remover");
    return { ...base, guest, guestWallet: personalWallet, shared, removeGrant: access.grant };
  }

  it("remove, tira das carteiras, ARQUIVA a pessoal (não apaga) e audita", async () => {
    const c = await coupleWithSharedWallet("EDITOR");
    await removeHouseholdMember(prisma, c.removeGrant, c.guest.id, TEST_CTX);

    expect(await prisma.householdMember.count({ where: { userId: c.guest.id } })).toBe(0);
    expect(await prisma.walletMember.count({ where: { userId: c.guest.id } })).toBe(0);
    const personal = await prisma.wallet.findUniqueOrThrow({ where: { id: c.guestWallet.id } });
    expect(personal.archivedAt).not.toBeNull();
    expect(await auditActions(c.household.id)).toContain("household.member_removed");
  });

  it("recusa se a pessoa for a ÚNICA dona de uma carteira compartilhada", async () => {
    const c = await coupleWithSharedWallet("OWNER");
    const error = await removeHouseholdMember(prisma, c.removeGrant, c.guest.id, TEST_CTX).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe("SOLE_WALLET_OWNER");
    // os detalhes dizem qual carteira resolver antes (a tela mostra o nome)
    expect((error as DomainError).details).toEqual({ wallets: ["Viagem"] });
  });

  it("a dona não se remove; e não remove outra dona", async () => {
    const c = await coupleWithSharedWallet("EDITOR");
    expect(
      await dbError(removeHouseholdMember(prisma, c.removeGrant, c.owner.id, TEST_CTX)),
    ).toContain("CANNOT_REMOVE_SELF");
    await prisma.householdMember.update({
      where: { householdId_userId: { householdId: c.household.id, userId: c.guest.id } },
      data: { role: "OWNER" },
    });
    expect(
      await dbError(removeHouseholdMember(prisma, c.removeGrant, c.guest.id, TEST_CTX)),
    ).toContain("CANNOT_REMOVE_OWNER");
  });

  it("IDOR: id de alguém de outro lar dá NOT_FOUND", async () => {
    const a = await coupleWithSharedWallet("EDITOR");
    const b = await ownerWithHousehold();
    expect(
      await dbError(removeHouseholdMember(prisma, a.removeGrant, b.owner.id, TEST_CTX)),
    ).toContain("NOT_FOUND");
  });
});

describe("atividade do lar", () => {
  it("lista os eventos mais novos primeiro, com o nome de quem fez", async () => {
    const { owner } = await ownerWithHousehold();
    const access = await authorizeHousehold(prisma, owner.id, "view_activity");
    if (!access.ok) throw new Error("a dona deveria ver a atividade");
    const activity = await listHouseholdActivity(prisma, access.grant);
    expect(activity.map((a) => a.action)).toEqual(["wallet.created", "household.created"]);
    expect(activity[0]?.actorName).toBe(owner.name);
  });
});
