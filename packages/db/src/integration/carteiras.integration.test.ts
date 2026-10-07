// Carteiras e quem participa delas (M06): criar compartilhada, renomear, arquivar,
// adicionar, mudar papel, remover, sair. A regra que mais importa: carteira compartilhada
// nunca fica sem dono, nem quando dois donos se rebaixam ao mesmo tempo.
//
// Rode com: pnpm test:integration
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorizeHousehold, authorizeWallet } from "../access";
import {
  addWalletMember,
  createSharedWallet,
  getWalletDetails,
  leaveWallet,
  listAddableMembers,
  listMyWallets,
  removeWalletMember,
  renameWallet,
  setWalletArchived,
  setWalletMemberRole,
} from "../wallets";
import {
  auditActions,
  createLoosePerson,
  createTestHousehold,
  dbError,
  deletePeople,
  deleteTestHousehold,
  prisma,
  TEST_CTX,
  type TestHousehold,
} from "./fixtures";

let h: TestHousehold;
let other: TestHousehold;
beforeEach(async () => {
  [h, other] = await Promise.all([createTestHousehold(), createTestHousehold()]);
});
afterEach(async () => {
  await Promise.all([deleteTestHousehold(h), deleteTestHousehold(other)]);
});

/** Crachá ou erro: nos testes, uma recusa inesperada é falha. */
async function grant<A extends Parameters<typeof authorizeWallet>[3]>(
  userId: string,
  walletId: string,
  action: A,
) {
  const access = await authorizeWallet(prisma, userId, walletId, action);
  if (!access.ok) throw new Error(`esperava acesso a ${action}, veio ${access.reason}`);
  return access.grant;
}

async function householdGrant(userId: string) {
  const access = await authorizeHousehold(prisma, userId, "create_wallet");
  if (!access.ok) throw new Error("esperava poder criar carteira");
  return access.grant;
}

const roleOf = async (walletId: string, userId: string) =>
  (
    await prisma.walletMember.findUnique({
      where: { walletId_userId: { walletId, userId } },
    })
  )?.role ?? null;

describe("criar carteira compartilhada", () => {
  it("quem cria é dona; a parceira entra com o papel escolhido; audita", async () => {
    const wallet = await createSharedWallet(
      prisma,
      await householdGrant(h.partner.id), // MEMBER do lar também cria
      { name: "Viagem 2027", members: [{ userId: h.holder.id, role: "VIEWER" }] },
      TEST_CTX,
    );
    expect(wallet.kind).toBe("SHARED");
    expect(await roleOf(wallet.id, h.partner.id)).toBe("OWNER");
    expect(await roleOf(wallet.id, h.holder.id)).toBe("VIEWER");
    expect(await auditActions(h.householdId)).toContain("wallet.created");
  });

  it("ignora a própria pessoa na lista (ela já é dona)", async () => {
    const wallet = await createSharedWallet(
      prisma,
      await householdGrant(h.holder.id),
      { name: "Só eu", members: [{ userId: h.holder.id, role: "VIEWER" }] },
      TEST_CTX,
    );
    expect(await roleOf(wallet.id, h.holder.id)).toBe("OWNER");
  });

  it("IDOR: não coloca gente de OUTRO lar", async () => {
    const error = await dbError(
      createSharedWallet(
        prisma,
        await householdGrant(h.holder.id),
        { name: "Invasão", members: [{ userId: other.holder.id, role: "EDITOR" }] },
        TEST_CTX,
      ),
    );
    expect(error).toContain("NOT_HOUSEHOLD_MEMBER");
  });

  it("o banco recusa nome com mais de 60 caracteres (wallet_name_length_check)", async () => {
    const error = await dbError(
      createSharedWallet(
        prisma,
        await householdGrant(h.holder.id),
        { name: "x".repeat(61), members: [] },
        TEST_CTX,
      ),
    );
    expect(error).toContain("wallet_name_length_check");
  });
});

describe("listar e ver", () => {
  it("listMyWallets mostra só as carteiras da pessoa, pessoal primeiro", async () => {
    const mine = await listMyWallets(prisma, h.partner.id);
    expect(mine.map((w) => [w.name, w.kind, w.role])).toEqual([
      ["Parceira", "PERSONAL", "OWNER"],
      ["Casa", "SHARED", "OWNER"],
    ]);
    // nada do outro lar, nada da carteira pessoal da titular
    expect(mine.some((w) => w.id === h.holderWallet.id || w.id === other.home.id)).toBe(false);
  });

  it("getWalletDetails traz os membros com nome", async () => {
    const details = await getWalletDetails(prisma, await grant(h.holder.id, h.home.id, "view"));
    expect(details.members.map((m) => m.userId).sort()).toEqual([h.holder.id, h.partner.id].sort());
    expect(details.myRole).toBe("OWNER");
  });

  it("listAddableMembers mostra só quem é do lar e ainda não está na carteira", async () => {
    await prisma.walletMember.delete({
      where: { walletId_userId: { walletId: h.home.id, userId: h.partner.id } },
    });
    const addable = await listAddableMembers(
      prisma,
      await grant(h.holder.id, h.home.id, "manage_members"),
    );
    expect(addable.map((m) => m.userId)).toEqual([h.partner.id]);
  });
});

describe("renomear e arquivar", () => {
  it("renomeia e grava de/para na auditoria", async () => {
    await renameWallet(
      prisma,
      await grant(h.holder.id, h.home.id, "rename"),
      "Lar doce lar",
      TEST_CTX,
    );
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { householdId: h.householdId, action: "wallet.renamed" },
    });
    expect(log.metadata).toEqual({ from: "Casa", to: "Lar doce lar" });
    expect(log.ipAddress).toBe(TEST_CTX.ip);
  });

  it("arquiva e restaura", async () => {
    await setWalletArchived(prisma, await grant(h.holder.id, h.home.id, "archive"), true, TEST_CTX);
    expect(
      (await prisma.wallet.findUniqueOrThrow({ where: { id: h.home.id } })).archivedAt,
    ).not.toBeNull();
    // arquivada: só "view" e "archive" valem
    expect((await authorizeWallet(prisma, h.holder.id, h.home.id, "rename")).ok).toBe(false);
    await setWalletArchived(
      prisma,
      await grant(h.holder.id, h.home.id, "archive"),
      false,
      TEST_CTX,
    );
    expect(await auditActions(h.householdId)).toEqual(
      expect.arrayContaining(["wallet.archived", "wallet.restored"]),
    );
  });
});

describe("quem participa", () => {
  it("muda o papel e audita de/para", async () => {
    await setWalletMemberRole(
      prisma,
      await grant(h.holder.id, h.home.id, "manage_members"),
      { userId: h.partner.id, role: "VIEWER" },
      TEST_CTX,
    );
    expect(await roleOf(h.home.id, h.partner.id)).toBe("VIEWER");
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { householdId: h.householdId, action: "wallet.role_changed" },
    });
    expect(log.metadata).toEqual({ userId: h.partner.id, from: "OWNER", to: "VIEWER" });
  });

  it("mesmo papel: não muda nada e não audita", async () => {
    await setWalletMemberRole(
      prisma,
      await grant(h.holder.id, h.home.id, "manage_members"),
      { userId: h.partner.id, role: "OWNER" },
      TEST_CTX,
    );
    expect(await auditActions(h.householdId)).not.toContain("wallet.role_changed");
  });

  it("recusa rebaixar ou remover a última dona (LAST_OWNER)", async () => {
    const g = await grant(h.holder.id, h.home.id, "manage_members");
    await removeWalletMember(prisma, g, h.partner.id, TEST_CTX); // agora a titular é a única dona
    expect(
      await dbError(
        setWalletMemberRole(prisma, g, { userId: h.holder.id, role: "EDITOR" }, TEST_CTX),
      ),
    ).toContain("LAST_OWNER");
    expect(
      await dbError(leaveWallet(prisma, await grant(h.holder.id, h.home.id, "leave"), TEST_CTX)),
    ).toContain("LAST_OWNER");
  });

  it("CORRIDA: duas donas se rebaixam ao mesmo tempo; a carteira continua com uma dona", async () => {
    // Cada uma pega o crachá ANTES (as duas são donas nesse momento)...
    const holderGrant = await grant(h.holder.id, h.home.id, "manage_members");
    const partnerGrant = await grant(h.partner.id, h.home.id, "manage_members");
    // ...e as duas gravam juntas, cada uma rebaixando a outra
    const results = await Promise.allSettled([
      setWalletMemberRole(prisma, holderGrant, { userId: h.partner.id, role: "VIEWER" }, TEST_CTX),
      setWalletMemberRole(prisma, partnerGrant, { userId: h.holder.id, role: "VIEWER" }, TEST_CTX),
    ]);
    // Com a trava (FOR UPDATE), a segunda espera, relê e descobre que já não é dona
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const owners = await prisma.walletMember.count({
      where: { walletId: h.home.id, role: "OWNER" },
    });
    expect(owners).toBe(1);
  });

  it("adiciona alguém do lar; recusa quem já está e quem é de fora", async () => {
    const g = await grant(h.holder.id, h.home.id, "manage_members");
    await removeWalletMember(prisma, g, h.partner.id, TEST_CTX);
    await addWalletMember(prisma, g, { userId: h.partner.id, role: "EDITOR" }, TEST_CTX);
    expect(await roleOf(h.home.id, h.partner.id)).toBe("EDITOR");
    expect(
      await dbError(addWalletMember(prisma, g, { userId: h.partner.id, role: "VIEWER" }, TEST_CTX)),
    ).toContain("ALREADY_MEMBER");
    expect(
      await dbError(
        addWalletMember(prisma, g, { userId: other.holder.id, role: "VIEWER" }, TEST_CTX),
      ),
    ).toContain("NOT_HOUSEHOLD_MEMBER");
    const loose = await createLoosePerson("solta");
    try {
      expect(
        await dbError(addWalletMember(prisma, g, { userId: loose.id, role: "VIEWER" }, TEST_CTX)),
      ).toContain("NOT_HOUSEHOLD_MEMBER");
    } finally {
      await deletePeople([loose.id]);
    }
  });

  it("a parceira sai da Casa; a auditoria registra member_left", async () => {
    await leaveWallet(prisma, await grant(h.partner.id, h.home.id, "leave"), TEST_CTX);
    expect(await roleOf(h.home.id, h.partner.id)).toBeNull();
    expect(await auditActions(h.householdId)).toContain("wallet.member_left");
  });

  it("toda mudança aparece na auditoria na ordem em que aconteceu", async () => {
    const g = await grant(h.holder.id, h.home.id, "manage_members");
    await setWalletMemberRole(prisma, g, { userId: h.partner.id, role: "EDITOR" }, TEST_CTX);
    await removeWalletMember(prisma, g, h.partner.id, TEST_CTX);
    await addWalletMember(prisma, g, { userId: h.partner.id, role: "VIEWER" }, TEST_CTX);
    expect(await auditActions(h.householdId)).toEqual([
      "wallet.role_changed",
      "wallet.member_removed",
      "wallet.member_added",
    ]);
  });
});
