// A matriz de papéis do FinTrack: QUEM pode fazer O QUÊ em cada carteira e no lar (M06).
//
// Regra pura, sem banco: recebe o papel da pessoa e o tipo da carteira e responde sim ou não.
// Fica aqui, e não espalhada pelas telas, por três motivos:
//   1. um lugar só para ler e revisar ("o viewer pode exportar?" → olhe a tabela abaixo);
//   2. testável em milissegundos, linha por linha (access.test.ts);
//   3. a documentação (docs/permissoes.md) é conferida contra ESTA tabela por um teste.
//
// Quem chama: packages/db/src/access.ts (authorizeWallet / authorizeHousehold), que busca o
// papel no banco e pergunta aqui. As telas e as Server Actions nunca decidem sozinhas.

// ── Papéis (os mesmos valores dos enums do banco) ───────────────────────────────

/** Papel numa carteira (enum WalletRole do schema). */
export type WalletRole = "OWNER" | "EDITOR" | "VIEWER";
/** Tipo da carteira (enum WalletKind do schema). */
export type WalletKind = "PERSONAL" | "SHARED";
/** Papel no lar (enum HouseholdRole do schema). */
export type HouseholdRole = "OWNER" | "MEMBER";

export const WALLET_ROLES: readonly WalletRole[] = ["OWNER", "EDITOR", "VIEWER"];
export const HOUSEHOLD_ROLES: readonly HouseholdRole[] = ["OWNER", "MEMBER"];

// ── O que se faz numa carteira ──────────────────────────────────────────────────

/**
 * Ações numa carteira. Os nomes são os que aparecem nos testes, nos logs e na auditoria.
 *   view            ver a carteira, os membros e (M07) os lançamentos
 *   edit            lançar, editar e excluir lançamentos (M07)
 *   export          exportar os lançamentos em CSV (M07; dado sensível: só OWNER)
 *   rename          mudar o nome
 *   manage_members  adicionar, remover e mudar o papel de outras pessoas
 *   archive         arquivar ou restaurar (esconde sem apagar o histórico)
 *   leave           sair da carteira (só compartilhada; o último dono não sai)
 */
export type WalletAction =
  "view" | "edit" | "export" | "rename" | "manage_members" | "archive" | "leave";

export const WALLET_ACTIONS: readonly WalletAction[] = [
  "view",
  "edit",
  "export",
  "rename",
  "manage_members",
  "archive",
  "leave",
];

/**
 * A tabela. Cada linha é uma ação; cada coluna, um papel; a última coluna diz se a ação
 * só existe em carteira compartilhada. É a fonte única: mudar uma regra é mudar esta tabela
 * (e o teste de documentação avisa que docs/permissoes.md precisa acompanhar).
 */
export const WALLET_MATRIX: Readonly<
  Record<WalletAction, { OWNER: boolean; EDITOR: boolean; VIEWER: boolean; sharedOnly: boolean }>
> = {
  view: { OWNER: true, EDITOR: true, VIEWER: true, sharedOnly: false },
  edit: { OWNER: true, EDITOR: true, VIEWER: false, sharedOnly: false },
  export: { OWNER: true, EDITOR: false, VIEWER: false, sharedOnly: false },
  rename: { OWNER: true, EDITOR: false, VIEWER: false, sharedOnly: false },
  // Carteira PESSOAL não se compartilha: quem quer dividir cria uma compartilhada
  manage_members: { OWNER: true, EDITOR: false, VIEWER: false, sharedOnly: true },
  // A pessoal vive enquanto a pessoa estiver no lar; arquivar só a compartilhada
  archive: { OWNER: true, EDITOR: false, VIEWER: false, sharedOnly: true },
  leave: { OWNER: true, EDITOR: true, VIEWER: true, sharedOnly: true },
};

/** O que uma carteira ARQUIVADA ainda permite: olhar e desarquivar. */
const ALLOWED_WHEN_ARCHIVED: ReadonlySet<WalletAction> = new Set(["view", "archive"]);

/** Por que uma ação foi negada a quem PARTICIPA da carteira (quem não participa recebe 404). */
export type WalletDenialReason = "ROLE" | "PERSONAL_WALLET" | "ARCHIVED";

export type WalletDecision = { allowed: true } | { allowed: false; reason: WalletDenialReason };

/**
 * A pergunta central: esta pessoa, com este papel, pode fazer esta ação nesta carteira?
 *
 *   canInWallet("VIEWER", "edit", { kind: "SHARED", archived: false })
 *   // → { allowed: false, reason: "ROLE" }
 */
export function canInWallet(
  role: WalletRole,
  action: WalletAction,
  wallet: { kind: WalletKind; archived: boolean },
): WalletDecision {
  const rule = WALLET_MATRIX[action];
  // A ordem importa só para a mensagem: o papel primeiro, depois o tipo, depois o arquivo
  if (!rule[role]) return { allowed: false, reason: "ROLE" };
  if (rule.sharedOnly && wallet.kind === "PERSONAL") {
    return { allowed: false, reason: "PERSONAL_WALLET" };
  }
  if (wallet.archived && !ALLOWED_WHEN_ARCHIVED.has(action)) {
    return { allowed: false, reason: "ARCHIVED" };
  }
  return { allowed: true };
}

// ── O que se faz no lar ─────────────────────────────────────────────────────────

/**
 * Ações no lar (o grupo de pessoas).
 *   view           ver o lar e quem participa
 *   invite         convidar alguém (gera o link de uso único) e cancelar convites
 *   remove_member  tirar alguém do lar
 *   create_wallet  criar uma carteira compartilhada
 *   view_activity  ver a trilha de auditoria do lar
 */
export type HouseholdAction =
  "view" | "invite" | "remove_member" | "create_wallet" | "view_activity";

export const HOUSEHOLD_ACTIONS: readonly HouseholdAction[] = [
  "view",
  "invite",
  "remove_member",
  "create_wallet",
  "view_activity",
];

export const HOUSEHOLD_MATRIX: Readonly<
  Record<HouseholdAction, { OWNER: boolean; MEMBER: boolean }>
> = {
  view: { OWNER: true, MEMBER: true },
  invite: { OWNER: true, MEMBER: false },
  remove_member: { OWNER: true, MEMBER: false },
  create_wallet: { OWNER: true, MEMBER: true },
  view_activity: { OWNER: true, MEMBER: false },
};

export function canInHousehold(role: HouseholdRole, action: HouseholdAction): boolean {
  return HOUSEHOLD_MATRIX[action][role];
}

// ── Regras de quem fica: o último dono ─────────────────────────────────────────

/** Por que uma mudança na lista de membros de uma carteira foi recusada. */
export type MembershipChangeError = "LAST_OWNER" | "NOT_A_MEMBER" | "ALREADY_MEMBER";

/** Uma mudança na lista de membros de uma carteira compartilhada. */
export type MembershipChange =
  | { type: "add"; userId: string; role: WalletRole }
  | { type: "set_role"; userId: string; role: WalletRole }
  | { type: "remove"; userId: string };

/**
 * Confere se a mudança deixa a carteira num estado válido. A regra principal: uma carteira
 * compartilhada nunca fica sem dono (sem OWNER ninguém mais conseguiria administrá-la).
 *
 * Devolve null quando a mudança pode ser feita, ou o motivo da recusa.
 * Quem chama precisa ler os membros DENTRO da transação, com a carteira travada
 * (SELECT ... FOR UPDATE), para dois donos não se rebaixarem ao mesmo tempo.
 */
export function checkMembershipChange(
  members: readonly { userId: string; role: WalletRole }[],
  change: MembershipChange,
): MembershipChangeError | null {
  const current = members.find((m) => m.userId === change.userId);

  if (change.type === "add") return current ? "ALREADY_MEMBER" : null;
  if (!current) return "NOT_A_MEMBER";

  const owners = members.filter((m) => m.role === "OWNER").length;
  const losesOwner =
    current.role === "OWNER" && (change.type === "remove" || change.role !== "OWNER");
  return losesOwner && owners <= 1 ? "LAST_OWNER" : null;
}

// ── Convites ────────────────────────────────────────────────────────────────────

/** Quanto tempo um link de convite vale: 72 horas. */
export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

export type InviteStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

/**
 * Estado de um convite num momento. Aceito e cancelado valem para sempre; os outros
 * dependem do relógio. `now` é parâmetro (e não `new Date()` aqui dentro) para o teste
 * controlar o tempo.
 */
export function inviteStatus(
  invite: { expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null },
  now: Date,
): InviteStatus {
  if (invite.acceptedAt) return "ACCEPTED";
  if (invite.revokedAt) return "REVOKED";
  return invite.expiresAt.getTime() > now.getTime() ? "PENDING" : "EXPIRED";
}

/** E-mail do convite como o banco guarda: sem espaços nas pontas e em minúsculas. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
