// O bot de lançamento pelo WhatsApp (M11, ADR-018): o vínculo do número, a mensagem que chega
// (uma vez só), a leitura, o rascunho, o Confirmar, o Desfazer e a conta das respostas grátis.
//
// O caminho de uma mensagem:
//   webhook   recordIncoming: grava a mensagem (wamid único) com o texto CIFRADO e diz se ela
//             vai para a fila. Número não vinculado que não manda "vincular": nada é gravado
//             além de uma linha sem texto (para contar)
//   fila      processBotMessage: toma a mensagem (marca como lida e apaga o texto) antes de
//             qualquer efeito, decide e grava; devolve as respostas para quem chamou mandar DEPOIS
//             (uma resposta perdida nunca vira lançamento duplicado)
//   resposta  reserveReply: cada resposta reserva um lugar na conta do mês antes de sair
//
// O bot só lança nas carteiras em que quem mandou pode editar (os crachás de sempre), e só com
// as contas e os cartões que ele pode usar. O número vinculado nunca vira login.
import { createHash, createHmac, hkdfSync, randomInt, randomUUID } from "node:crypto";
import {
  askCardMessage,
  askWalletMessage,
  BOT_DRAFT_TTL_MS,
  BOT_LINK_BLOCK_MS,
  BOT_LINK_CODE_TTL_MS,
  BOT_STOP_AT,
  BOT_UNDO_MS,
  BOT_WARN_AT,
  ALREADY_DONE_MESSAGE,
  canInHousehold,
  botMonth,
  CANCELLED_MESSAGE,
  chooseBotPayment,
  chooseBotWallet,
  civilFromDbDate,
  confirmedMessage,
  dbDateFromCivil,
  decodeAction,
  EXPIRED_MESSAGE,
  installmentAmounts,
  isEssentialReply,
  linkBlocked,
  linkedMessage,
  nameOnlyMessage,
  normalizePhone,
  notUnderstoodMessage,
  parseBotMessage,
  parseLinkCommand,
  phoneLastFour,
  proposalMessage,
  todayCivil,
  UNDO_EXPIRED_MESSAGE,
  UNDONE_MESSAGE,
  warningMessage,
  type BotAction,
  type BotDefaults,
  type BotMessage as BotReplyMessage,
  type BotMethodLabel,
  type BotOptions,
  type BotReplyKind,
  type Cents,
  type CivilDate,
} from "@fintrack/core";
import {
  authorizeAccountUse,
  authorizeScope,
  authorizeWallet,
  DomainError,
  isUuid,
  type HouseholdGrant,
} from "./access";
import { writeAudit, type RequestContext } from "./audit";
import { suggestCategory, type CascadeServices } from "./categories";
import { openSecret, sealSecret, type SecretKeyring } from "./connection-secret";
import type { BotMessageKind, BotMessageOutcome, PrismaClient } from "./generated/prisma/client";
import { createInstallmentPurchase } from "./installments";
import { fromDbDecimal, toDbDecimal } from "./money";
import { createTransaction } from "./transactions";

/** Mensagens (e o registro dos números não vinculados) somem depois de 90 dias. */
export const BOT_MESSAGE_RETENTION_DAYS = 90;

// ── Segredos ────────────────────────────────────────────────────────────────────

/**
 * A chave do HMAC dos números, derivada do segredo do app (BETTER_AUTH_SECRET) com HKDF. Sem
 * variável nova; trocar o segredo derruba as sessões, o 2FA e, junto, os vínculos do bot (cada
 * pessoa vincula de novo).
 */
export function botPhoneKey(appSecret: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", appSecret, "fintrack", "fintrack:bot-phone:v1", 32) as ArrayBuffer,
  );
}

/** HMAC-SHA256 do número (só dígitos). É o que liga a mensagem à pessoa. */
export function phoneHash(key: Buffer, phone: string): string {
  return createHmac("sha256", key).update(normalizePhone(phone)).digest("hex");
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Código de 6 dígitos (aleatório criptográfico). */
function newLinkCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

// ── Configuração (a tela de Ajustes) ────────────────────────────────────────────

/** Gera o código de vínculo da pessoa (o anterior que não foi usado deixa de valer). */
export async function createLinkCode(
  db: PrismaClient,
  grant: HouseholdGrant<"view">,
  keyring: SecretKeyring,
  ctx: RequestContext,
  now: Date = new Date(),
): Promise<{ id: string; code: string; expiresAt: Date }> {
  const householdId = grant.household.id;
  const expiresAt = new Date(now.getTime() + BOT_LINK_CODE_TTL_MS);
  return db.$transaction(async (tx) => {
    await tx.botLinkCode.deleteMany({ where: { userId: grant.userId, usedAt: null } });
    // Um código aberto não pode coincidir com outro aberto (de outra pessoa): sorteia de novo
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = newLinkCode();
      const codeHash = sha256(code);
      const clash = await tx.botLinkCode.findFirst({
        where: { codeHash, usedAt: null, expiresAt: { gt: now } },
        select: { id: true },
      });
      if (clash) continue;
      const id = randomUUID();
      await tx.botLinkCode.create({
        data: {
          id,
          householdId,
          userId: grant.userId,
          codeHash,
          codeSealed: sealSecret(keyring, id, code),
          expiresAt,
          createdAt: now,
        },
      });
      await writeAudit(
        tx,
        {
          actorId: grant.userId,
          householdId,
          action: "bot.link_code_created",
          entity: "household_member",
          entityId: grant.userId,
          metadata: {},
        },
        ctx,
      );
      return { id, code, expiresAt };
    }
    throw new DomainError("BOT_LINK_CODE_BUSY");
  });
}

/**
 * A tela do código (Ajustes › Bot › Vincular): esperando a mensagem (com o código, para a pessoa
 * copiar), vinculado (o código foi usado) ou vencido. Só o código da própria pessoa.
 */
export async function linkCodeStatus(
  db: PrismaClient,
  userId: string,
  codeId: string,
  keyring: SecretKeyring,
  now: Date = new Date(),
): Promise<
  | { state: "WAITING"; code: string; expiresAt: Date }
  | { state: "LINKED"; lastFour: string }
  | { state: "EXPIRED" }
> {
  if (!isUuid(codeId)) return { state: "EXPIRED" };
  const row = await db.botLinkCode.findFirst({
    where: { id: codeId, userId },
    select: { id: true, codeSealed: true, expiresAt: true, usedAt: true },
  });
  if (!row) return { state: "EXPIRED" };
  if (row.usedAt) {
    const link = await db.botLink.findUnique({
      where: { userId },
      select: { phoneLastFour: true },
    });
    return link ? { state: "LINKED", lastFour: link.phoneLastFour } : { state: "EXPIRED" };
  }
  if (row.expiresAt <= now || !row.codeSealed) return { state: "EXPIRED" };
  return {
    state: "WAITING",
    code: openSecret(keyring, row.id, row.codeSealed),
    expiresAt: row.expiresAt,
  };
}

/** Desvincula o número da pessoa. Sem número vinculado: não faz nada. */
export async function unlinkBot(
  db: PrismaClient,
  grant: HouseholdGrant<"view">,
  ctx: RequestContext,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const link = await tx.botLink.findUnique({
      where: { userId: grant.userId },
      select: { phoneLastFour: true },
    });
    if (!link) return false;
    await tx.botLink.delete({ where: { userId: grant.userId } });
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId: grant.household.id,
        action: "bot.unlinked",
        entity: "household_member",
        entityId: grant.userId,
        metadata: { phone: `***${link.phoneLastFour}` },
      },
      ctx,
    );
    return true;
  });
}

/** O interruptor do lar. Desligado, o bot não lê nem responde ninguém do lar. */
export async function setBotEnabled(
  db: PrismaClient,
  grant: HouseholdGrant<"manage_bot">,
  enabled: boolean,
  ctx: RequestContext,
  now: Date = new Date(),
): Promise<void> {
  const householdId = grant.household.id;
  await db.$transaction(async (tx) => {
    const current = await tx.household.findUniqueOrThrow({
      where: { id: householdId },
      select: { botDisabledAt: true },
    });
    if ((current.botDisabledAt === null) === enabled) return;
    await tx.household.update({
      where: { id: householdId },
      data: { botDisabledAt: enabled ? null : now },
    });
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId,
        action: enabled ? "bot.enabled" : "bot.disabled",
        entity: "household",
        entityId: householdId,
        metadata: {},
      },
      ctx,
    );
  });
}

type Named = { id: string; name: string };

/** O que a pessoa pode usar pelo bot: ambientes que edita, cartões e contas que usa. */
export async function botChoicesFor(db: PrismaClient, userId: string) {
  const scope = await authorizeScope(db, userId, "edit");
  const wallets: Named[] = scope.walletIds.length
    ? await db.wallet.findMany({
        where: { id: { in: [...scope.walletIds] }, archivedAt: null },
        orderBy: [{ kind: "desc" }, { name: "asc" }],
        select: { id: true, name: true },
      })
    : [];
  const accounts = scope.householdId
    ? await db.financialAccount.findMany({
        where: {
          householdId: scope.householdId,
          archivedAt: null,
          kind: { in: ["CHECKING", "SAVINGS", "CREDIT_CARD"] },
        },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          kind: true,
          cards: {
            where: { archivedAt: null },
            orderBy: { nickname: "asc" },
            select: { id: true, nickname: true },
          },
        },
      })
    : [];
  const cards: { id: string; nickname: string; accountId: string; credit: boolean }[] = [];
  const debitAccounts: Named[] = [];
  for (const account of accounts) {
    const access = await authorizeAccountUse(db, userId, account.id);
    if (!access.ok) continue;
    const usable = new Set(access.grant.cardIds);
    for (const card of account.cards) {
      if (usable.has(card.id))
        cards.push({
          id: card.id,
          nickname: card.nickname,
          accountId: account.id,
          credit: account.kind === "CREDIT_CARD",
        });
    }
    // Pela porta do cartão (adicional) a pessoa só lança com o próprio cartão: sem débito solto
    if (account.kind !== "CREDIT_CARD" && access.grant.via === "WALLET")
      debitAccounts.push({ id: account.id, name: account.name });
  }
  return { householdId: scope.householdId, wallets, cards, debitAccounts };
}

export type BotChoices = Awaited<ReturnType<typeof botChoicesFor>>;

const optionsOf = (choices: BotChoices): BotOptions => ({
  walletIds: choices.wallets.map((w) => w.id),
  cards: choices.cards,
  debitAccountIds: choices.debitAccounts.map((a) => a.id),
});

async function defaultsFor(db: PrismaClient, userId: string): Promise<BotDefaults> {
  const pref = await db.botPreference.findUnique({
    where: { userId },
    select: { walletId: true, debitAccountId: true, creditCardId: true },
  });
  return pref ?? { walletId: null, debitAccountId: null, creditCardId: null };
}

/** Grava os padrões. Cada um precisa ser algo que a pessoa pode usar AGORA (ou vazio). */
export async function saveBotPreference(
  db: PrismaClient,
  grant: HouseholdGrant<"view">,
  input: BotDefaults,
): Promise<void> {
  const choices = await botChoicesFor(db, grant.userId);
  const ok = (id: string | null, list: readonly { id: string }[]) =>
    id === null || list.some((item) => item.id === id);
  if (
    !ok(input.walletId, choices.wallets) ||
    !ok(input.debitAccountId, choices.debitAccounts) ||
    !ok(
      input.creditCardId,
      choices.cards.filter((c) => c.credit),
    )
  )
    throw new DomainError("NOT_FOUND");
  await db.botPreference.upsert({
    where: { userId: grant.userId },
    create: { userId: grant.userId, householdId: grant.household.id, ...input },
    update: input,
  });
}

/** O mês da conta das respostas, para a tela. */
export async function botReplyUsage(
  db: PrismaClient,
  phoneNumberId: string,
  now: Date = new Date(),
) {
  const row = await db.botReplyCount.findUnique({
    where: { phoneNumberId_month: { phoneNumberId, month: botMonth(now) } },
    select: { used: true, warnedAt: true },
  });
  return { month: botMonth(now), used: row?.used ?? 0, warnedAt: row?.warnedAt ?? null };
}

/** A tela de Ajustes › Bot do WhatsApp. */
export async function botSettings(
  db: PrismaClient,
  grant: HouseholdGrant<"view">,
  phoneNumberId: string | null,
  now: Date = new Date(),
) {
  const householdId = grant.household.id;
  const [household, link, defaults, choices] = await Promise.all([
    db.household.findUniqueOrThrow({ where: { id: householdId }, select: { botDisabledAt: true } }),
    db.botLink.findUnique({
      where: { userId: grant.userId },
      select: { phoneLastFour: true, linkedAt: true },
    }),
    defaultsFor(db, grant.userId),
    botChoicesFor(db, grant.userId),
  ]);
  const usage = phoneNumberId ? await botReplyUsage(db, phoneNumberId, now) : null;
  const linkedCount = await db.botLink.count({ where: { householdId } });
  return {
    enabled: household.botDisabledAt === null,
    canManage: canInHousehold(grant.role, "manage_bot"),
    link,
    linkedCount,
    defaults,
    choices,
    usage,
    recent: await recentBotMessages(db, grant, now),
  };
}

export type BotSettings = Awaited<ReturnType<typeof botSettings>>;

/**
 * As últimas mensagens do lar, SEM o texto: quem (primeiro nome e final do número), quando e o
 * que aconteceu. Valor, categoria e ambiente só do que a pessoa que olha consegue ver.
 */
async function recentBotMessages(db: PrismaClient, grant: HouseholdGrant<"view">, now: Date) {
  const householdId = grant.household.id;
  const view = await authorizeScope(db, grant.userId, "view");
  const rows = await db.botMessage.findMany({
    // Só o que a pessoa escreveu: o clique num botão aparece como a situação da proposta
    where: {
      householdId,
      processedAt: { not: null },
      kind: { in: ["TEXT", "OTHER"] },
      outcome: { not: "UNKNOWN_NUMBER" },
    },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { id: true, createdAt: true, userId: true, outcome: true, draftId: true },
  });
  const drafts = await db.botDraft.findMany({
    where: { id: { in: rows.map((r) => r.draftId).filter((id): id is string => id !== null) } },
    select: {
      id: true,
      status: true,
      walletId: true,
      amount: true,
      installmentCount: true,
      description: true,
      categoryId: true,
    },
  });
  const people = await db.householdMember.findMany({
    where: { householdId },
    select: {
      userId: true,
      user: { select: { name: true } },
      botLink: { select: { phoneLastFour: true } },
    },
  });
  const categories = await db.category.findMany({
    where: { id: { in: drafts.map((d) => d.categoryId).filter((id): id is string => !!id) } },
    select: { id: true, name: true },
  });
  const wallets = await db.wallet.findMany({
    where: { id: { in: drafts.map((d) => d.walletId).filter((id): id is string => !!id) } },
    select: { id: true, name: true },
  });
  const unknownToday = await db.botMessage.count({
    where: {
      outcome: "UNKNOWN_NUMBER",
      createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
    },
  });
  return {
    unknownToday,
    items: rows.map((row) => {
      const person = people.find((p) => p.userId === row.userId);
      const draft = drafts.find((d) => d.id === row.draftId);
      const visible = draft?.walletId ? view.walletIds.includes(draft.walletId) : false;
      return {
        id: row.id,
        at: row.createdAt,
        who: person ? (person.user.name.split(" ")[0] ?? person.user.name) : "Alguém do lar",
        lastFour: person?.botLink?.phoneLastFour ?? null,
        outcome: row.outcome as BotMessageOutcome,
        draftStatus: draft?.status ?? null,
        detail:
          draft && visible
            ? {
                cents: -fromDbDecimal(draft.amount),
                installments: draft.installmentCount,
                category: categories.find((c) => c.id === draft.categoryId)?.name ?? null,
                description: draft.description,
                wallet: wallets.find((w) => w.id === draft.walletId)?.name ?? null,
              }
            : null,
      };
    }),
  };
}

// ── A mensagem que chega ────────────────────────────────────────────────────────

/** Uma mensagem como o webhook entende (o adaptador do canal traduz o JSON da Meta para isto). */
export type IncomingBotMessage = {
  wamid: string;
  /** O número de quem mandou, só dígitos com o país (o "from" da Meta) */
  from: string;
  kind: BotMessageKind;
  sentAt: Date;
  /** O texto (TEXT) */
  text?: string;
  /** O id do botão clicado (BUTTON) */
  buttonId?: string;
};

export type BotSecrets = { phoneKey: Buffer; keyring: SecretKeyring };

type SealedBody = { from: string; text?: string; buttonId?: string };

/**
 * Grava a mensagem que chegou, uma vez só por wamid. Devolve o id para a fila, ou nulo quando
 * não há o que fazer (repetida, ou de número não vinculado que não é um "vincular").
 */
export async function recordIncoming(
  db: PrismaClient,
  secrets: BotSecrets,
  message: IncomingBotMessage,
  now: Date = new Date(),
): Promise<{ queue: string | null; duplicate: boolean }> {
  const hash = phoneHash(secrets.phoneKey, message.from);
  const link = await db.botLink.findUnique({
    where: { phoneHash: hash },
    select: { userId: true, householdId: true },
  });
  const isLinkCommand = message.kind === "TEXT" && parseLinkCommand(message.text ?? "") !== null;
  const id = randomUUID();
  if (!link && !isLinkCommand) {
    // Número desconhecido: uma linha sem texto e sem dono, só para contar; nada na fila
    const created = await db.botMessage.createMany({
      data: [
        {
          id,
          wamid: message.wamid,
          phoneHash: hash,
          kind: message.kind,
          sentAt: message.sentAt,
          createdAt: now,
          processedAt: now,
          outcome: "UNKNOWN_NUMBER",
        },
      ],
      skipDuplicates: true,
    });
    return { queue: null, duplicate: created.count === 0 };
  }
  const body: SealedBody = { from: normalizePhone(message.from) };
  if (message.text !== undefined) body.text = message.text;
  if (message.buttonId !== undefined) body.buttonId = message.buttonId;
  const created = await db.botMessage.createMany({
    data: [
      {
        id,
        wamid: message.wamid,
        householdId: link?.householdId ?? null,
        userId: link?.userId ?? null,
        phoneHash: hash,
        kind: message.kind,
        sentAt: message.sentAt,
        createdAt: now,
        bodyCiphertext: sealSecret(secrets.keyring, id, JSON.stringify(body)),
      },
    ],
    skipDuplicates: true,
  });
  return created.count === 0 ? { queue: null, duplicate: true } : { queue: id, duplicate: false };
}

// ── A fila ──────────────────────────────────────────────────────────────────────

/** Uma resposta para mandar (depois do commit), com o tipo para a conta das grátis. */
export type BotReply = { to: string; kind: BotReplyKind; message: BotReplyMessage };

export type BotProcessResult = {
  outcome: BotMessageOutcome;
  /** O wamid, para marcar como lida (não é mensagem: não conta) */
  wamid: string;
  replies: BotReply[];
  /** O lar cujo dinheiro mudou (o painel recalcula) */
  financeChangedFor: string | null;
};

export type BotDeps = BotSecrets & {
  /** As camadas da cascata que dependem do serviço Python (o classificador) */
  services?: CascadeServices;
  /** O "hoje" de São Paulo (os testes fixam) */
  today?: CivilDate;
};

const METHOD_LABEL: Record<string, BotMethodLabel> = {
  CREDIT: "crédito",
  DEBIT: "débito",
  PIX: "pix",
};

/**
 * Lê UMA mensagem da fila. Tudo o que muda o banco acontece numa transação, que também marca a
 * mensagem como lida e apaga o texto; as respostas saem depois, por quem chamou. Mensagem que já
 * foi lida (a fila tentou de novo): nulo.
 */
export async function processBotMessage(
  db: PrismaClient,
  deps: BotDeps,
  messageId: string,
  now: Date = new Date(),
): Promise<BotProcessResult | null> {
  const row = await db.botMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      wamid: true,
      userId: true,
      householdId: true,
      phoneHash: true,
      kind: true,
      processedAt: true,
      bodyCiphertext: true,
    },
  });
  if (!row || row.processedAt || !row.bodyCiphertext) return null;
  const body = JSON.parse(openSecret(deps.keyring, row.id, row.bodyCiphertext)) as SealedBody;
  // Toma a mensagem para si ANTES de qualquer efeito: marca como lida e apaga o texto. Duas filas
  // ao mesmo tempo (uma repetição do pg-boss): só uma passa daqui. Se o processo cair no meio, a
  // mensagem fica lida sem resposta (a pessoa manda de novo); nunca vira dois rascunhos.
  const claimed = await db.botMessage.updateMany({
    where: { id: row.id, processedAt: null },
    data: { processedAt: now, outcome: "STALE", bodyCiphertext: null },
  });
  if (claimed.count === 0) return null;
  const today = deps.today ?? todayCivil(now);
  const done = async (
    outcome: BotMessageOutcome,
    replies: BotReply[] = [],
    extra: DoneExtra = {},
  ): Promise<BotProcessResult | null> => {
    await db.botMessage.update({
      where: { id: row.id },
      data: {
        outcome,
        ...(extra.draftId ? { draftId: extra.draftId } : {}),
        ...(extra.householdId !== undefined ? { householdId: extra.householdId } : {}),
        ...(extra.userId !== undefined ? { userId: extra.userId } : {}),
      },
    });
    return {
      outcome,
      wamid: row.wamid,
      replies,
      financeChangedFor: extra.financeChangedFor ?? null,
    };
  };
  const reply = (kind: BotReplyKind, message: BotReplyMessage): BotReply => ({
    to: body.from,
    kind,
    message,
  });

  // "vincular 123 456": de número novo ou de quem já está vinculado (troca de pessoa)
  const code = row.kind === "TEXT" ? parseLinkCommand(body.text ?? "") : null;
  if (code) return linkByCode(db, row, body, code, now, done, reply);

  // Vinculado quando chegou, mas pode ter sido desvinculado enquanto esperava na fila
  const link = row.userId
    ? await db.botLink.findUnique({
        where: { userId: row.userId },
        select: { userId: true, householdId: true, phoneHash: true },
      })
    : null;
  if (!link || link.phoneHash !== row.phoneHash) return done("UNKNOWN_NUMBER");
  const household = await db.household.findUniqueOrThrow({
    where: { id: link.householdId },
    select: { botDisabledAt: true },
  });
  if (household.botDisabledAt) return done("BOT_OFF");
  const userId = link.userId;

  if (row.kind === "OTHER")
    return done("NOT_UNDERSTOOD", [reply("NOT_UNDERSTOOD", notUnderstoodMessage("NOT_A_TEXT"))]);

  if (row.kind === "BUTTON") {
    const action = decodeAction(body.buttonId ?? "");
    if (!action) return done("STALE");
    return handleAction(db, deps, userId, action, now, today, done, reply);
  }

  // Um lançamento escrito
  const choices = await botChoicesFor(db, userId);
  const parsed = parseBotMessage(body.text ?? "", {
    today,
    wallets: choices.wallets,
    cards: choices.cards.map((c) => ({ id: c.id, name: c.nickname })),
  });
  if (!parsed.ok && parsed.error === "NAME_ONLY") {
    const nameOf = (list: readonly { id: string; name: string }[], ids: string[]) =>
      list.find((item) => item.id === ids[0])?.name ?? null;
    return done("NOT_UNDERSTOOD", [
      reply(
        "NOT_UNDERSTOOD",
        nameOnlyMessage({
          wallet: nameOf(choices.wallets, parsed.walletIds),
          card: nameOf(
            choices.cards.map((c) => ({ id: c.id, name: c.nickname })),
            parsed.cardIds,
          ),
        }),
      ),
    ]);
  }
  if (!parsed.ok) {
    return done(parsed.error === "CARD_NUMBER" ? "CARD_NUMBER" : "NOT_UNDERSTOOD", [
      reply("NOT_UNDERSTOOD", notUnderstoodMessage(parsed.error)),
    ]);
  }
  const entry = parsed.entry;
  const defaults = await defaultsFor(db, userId);
  const options = optionsOf(choices);
  const wallet = chooseBotWallet(entry.walletIds, defaults, options);
  const payment = chooseBotPayment(entry, defaults, options);
  if (wallet.kind === "NONE" || payment.kind === "NONE")
    return done("NOT_UNDERSTOOD", [reply("NOT_UNDERSTOOD", notUnderstoodMessage("NO_ACCOUNT"))]);

  const scope = await authorizeScope(db, userId, "view");
  const suggestion = await suggestCategory(
    db,
    scope,
    { description: entry.description, kind: "expense" },
    deps.services,
  );
  const draft = await db.botDraft.create({
    data: {
      householdId: link.householdId,
      userId,
      walletId: wallet.kind === "WALLET" ? wallet.walletId : null,
      accountId: payment.kind === "PAY" ? payment.accountId : null,
      cardId: payment.kind === "PAY" ? payment.cardId : null,
      method: payment.kind === "PAY" ? payment.method : "CREDIT",
      amount: toDbDecimal(entry.cents),
      description: entry.description,
      occurredOn: dbDateFromCivil(entry.occurredOn),
      installmentCount: entry.installments,
      categoryId: suggestion?.categoryId ?? null,
      createdAt: now,
    },
    select: { id: true },
  });
  const next = await nextStep(db, draft.id, choices, today);
  return done(next.outcome, [reply(next.kind, next.message)], {
    draftId: draft.id,
  });
}

type DoneExtra = {
  draftId?: string | null;
  householdId?: string | null;
  userId?: string | null;
  financeChangedFor?: string | null;
};
type Done = (
  outcome: BotMessageOutcome,
  replies?: BotReply[],
  extra?: DoneExtra,
) => Promise<BotProcessResult | null>;
type Reply = (kind: BotReplyKind, message: BotReplyMessage) => BotReply;

async function linkByCode(
  db: PrismaClient,
  row: { id: string; phoneHash: string },
  body: SealedBody,
  code: string,
  now: Date,
  done: Done,
  reply: Reply,
): Promise<BotProcessResult | null> {
  // Cinco erros numa hora: 24 h de silêncio para este número (nem confere o código)
  const failures = await db.botMessage.findMany({
    where: {
      phoneHash: row.phoneHash,
      outcome: "BAD_CODE",
      createdAt: { gte: new Date(now.getTime() - BOT_LINK_BLOCK_MS - 60 * 60 * 1000) },
    },
    select: { createdAt: true },
  });
  if (
    linkBlocked(
      failures.map((f) => f.createdAt),
      now,
    )
  )
    return done("BAD_CODE", [], { householdId: null });
  const linked = await db.$transaction(async (tx) => {
    const found = await tx.botLinkCode.findFirst({
      where: { codeHash: sha256(code), usedAt: null, expiresAt: { gt: now } },
      select: { id: true, userId: true, householdId: true },
    });
    if (!found) return null;
    const { count } = await tx.botLinkCode.updateMany({
      where: { id: found.id, usedAt: null },
      data: { usedAt: now, codeSealed: null },
    });
    if (count === 0) return null;
    // Uma pessoa por número e um número por pessoa: o vínculo anterior de cada lado sai
    const previous = await tx.botLink.findUnique({
      where: { phoneHash: row.phoneHash },
      select: { userId: true },
    });
    await tx.botLink.deleteMany({
      where: { OR: [{ phoneHash: row.phoneHash }, { userId: found.userId }] },
    });
    const lastFour = phoneLastFour(body.from);
    await tx.botLink.create({
      data: {
        userId: found.userId,
        householdId: found.householdId,
        phoneHash: row.phoneHash,
        phoneLastFour: lastFour,
        linkedAt: now,
      },
    });
    await writeAudit(
      tx,
      {
        actorId: found.userId,
        householdId: found.householdId,
        action: "bot.linked",
        entity: "household_member",
        entityId: found.userId,
        metadata: {
          phone: `***${lastFour}`,
          replacedOtherPerson: previous !== null && previous.userId !== found.userId,
        },
      },
      {},
    );
    return found;
  });
  // Código errado ou vencido: o mesmo silêncio de um número desconhecido (não revela nada)
  if (!linked) return done("BAD_CODE", [], { householdId: null });
  const [user, defaults, choices] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: linked.userId }, select: { name: true } }),
    defaultsFor(db, linked.userId),
    botChoicesFor(db, linked.userId),
  ]);
  const walletChoice = chooseBotWallet([], defaults, optionsOf(choices));
  const walletName =
    walletChoice.kind === "WALLET"
      ? (choices.wallets.find((w) => w.id === walletChoice.walletId)?.name ?? "padrão")
      : "que você escolher";
  return done(
    "LINKED",
    [reply("LINKED", linkedMessage(user.name.split(" ")[0] ?? user.name, walletName))],
    { householdId: linked.householdId, userId: linked.userId },
  );
}

/** O que falta no rascunho: perguntar o ambiente, o cartão, ou propor. */
async function nextStep(
  db: PrismaClient,
  draftId: string,
  choices: BotChoices,
  today: CivilDate,
): Promise<{ outcome: BotMessageOutcome; kind: BotReplyKind; message: BotReplyMessage }> {
  const draft = await db.botDraft.findUniqueOrThrow({
    where: { id: draftId },
    select: {
      id: true,
      walletId: true,
      accountId: true,
      cardId: true,
      method: true,
      amount: true,
      description: true,
      occurredOn: true,
      installmentCount: true,
      categoryId: true,
      userId: true,
    },
  });
  const cents = fromDbDecimal(draft.amount);
  const category = draft.categoryId
    ? await db.category.findUnique({ where: { id: draft.categoryId }, select: { name: true } })
    : null;
  const title = category?.name ?? draft.description;
  if (!draft.walletId) {
    const defaults = await defaultsFor(db, draft.userId);
    const choice = chooseBotWallet([], defaults, optionsOf(choices));
    const ids = choice.kind === "ASK" ? choice.walletIds : choices.wallets.map((w) => w.id);
    return {
      outcome: "ASKED",
      kind: "ASK",
      message: askWalletMessage(
        { cents, title },
        draft.id,
        ids.map((id) => choices.wallets.find((w) => w.id === id)!).filter(Boolean),
      ),
    };
  }
  if (!draft.accountId) {
    const pool = choices.cards.filter((c) => c.credit);
    return {
      outcome: "ASKED",
      kind: "ASK",
      message: askCardMessage({ cents, title }, draft.id, pool),
    };
  }
  const card = draft.cardId ? choices.cards.find((c) => c.id === draft.cardId) : null;
  const account = choices.debitAccounts.find((a) => a.id === draft.accountId);
  const wallet = choices.wallets.find((w) => w.id === draft.walletId);
  const perInstallment =
    draft.installmentCount !== null ? installmentAmounts(cents, draft.installmentCount) : null;
  return {
    outcome: "PROPOSED",
    kind: "PROPOSAL",
    message: proposalMessage(
      {
        cents,
        title,
        occurredOn: civilFromDbDate(draft.occurredOn),
        today,
        method: METHOD_LABEL[draft.method] ?? "crédito",
        payWith: card?.nickname ?? account?.name ?? "conta",
        walletName: wallet?.name ?? "—",
        installments: draft.installmentCount,
        // A parcela que se repete (a sobra de centavos fica na 1ª)
        installmentCents: perInstallment ? perInstallment[perInstallment.length - 1]! : null,
      },
      draft.id,
    ),
  };
}

async function handleAction(
  db: PrismaClient,
  deps: BotDeps,
  userId: string,
  action: BotAction,
  now: Date,
  today: CivilDate,
  done: Done,
  reply: Reply,
): Promise<BotProcessResult | null> {
  // O rascunho precisa ser DESTA pessoa: um id de botão de outra pessoa é ignorado em silêncio
  const draft = await db.botDraft.findFirst({
    where: { id: action.draftId, userId },
    select: { id: true, status: true, createdAt: true, decidedAt: true, householdId: true },
  });
  if (!draft) return done("STALE");

  switch (action.kind) {
    case "CONFIRM": {
      if (draft.status !== "OPEN")
        return done("STALE", [reply("NOT_UNDERSTOOD", ALREADY_DONE_MESSAGE)], {
          draftId: draft.id,
        });
      if (now.getTime() - draft.createdAt.getTime() > BOT_DRAFT_TTL_MS)
        return done("STALE", [reply("EXPIRED", EXPIRED_MESSAGE)], { draftId: draft.id });
      const confirmed = await confirmDraft(db, userId, draft.id, {}, deps.services, now, today);
      if (!confirmed.ok && confirmed.reason === "STALE")
        return done("STALE", [reply("NOT_UNDERSTOOD", ALREADY_DONE_MESSAGE)], {
          draftId: draft.id,
        });
      if (!confirmed.ok)
        return done(
          "NOT_UNDERSTOOD",
          [reply("NOT_UNDERSTOOD", notUnderstoodMessage("NO_ACCOUNT"))],
          {
            draftId: draft.id,
          },
        );
      return done(
        "CONFIRMED",
        [
          reply(
            "CONFIRMED",
            confirmedMessage(
              {
                cents: confirmed.cents,
                title: confirmed.title,
                installments: confirmed.installments,
              },
              draft.id,
            ),
          ),
        ],
        { draftId: draft.id, financeChangedFor: draft.householdId },
      );
    }
    case "CANCEL": {
      const cancelled = await cancelDraft(db, userId, draft.id, now);
      return done(
        cancelled ? "CANCELLED" : "STALE",
        [
          reply(
            cancelled ? "CANCELLED" : "NOT_UNDERSTOOD",
            cancelled ? CANCELLED_MESSAGE : ALREADY_DONE_MESSAGE,
          ),
        ],
        { draftId: draft.id },
      );
    }
    case "UNDO": {
      const undone = await undoDraft(db, userId, draft.id, {}, now);
      if (!undone)
        return done("STALE", [reply("NOT_UNDERSTOOD", UNDO_EXPIRED_MESSAGE)], {
          draftId: draft.id,
        });
      return done("UNDONE", [reply("UNDONE", UNDONE_MESSAGE)], {
        draftId: draft.id,
        financeChangedFor: draft.householdId,
      });
    }
    case "PICK_CARD":
    case "PICK_WALLET": {
      if (draft.status !== "OPEN")
        return done("STALE", [reply("NOT_UNDERSTOOD", ALREADY_DONE_MESSAGE)], {
          draftId: draft.id,
        });
      const choices = await botChoicesFor(db, userId);
      if (action.kind === "PICK_CARD") {
        const card = choices.cards.find((c) => c.id === action.cardId);
        if (!card) return done("STALE", [], { draftId: draft.id });
        await db.botDraft.updateMany({
          where: { id: draft.id, status: "OPEN" },
          data: {
            accountId: card.accountId,
            cardId: card.id,
            method: card.credit ? "CREDIT" : "DEBIT",
          },
        });
      } else {
        if (!choices.wallets.some((w) => w.id === action.walletId))
          return done("STALE", [], { draftId: draft.id });
        await db.botDraft.updateMany({
          where: { id: draft.id, status: "OPEN" },
          data: { walletId: action.walletId },
        });
      }
      const next = await nextStep(db, draft.id, choices, today);
      return done(next.outcome, [reply(next.kind, next.message)], { draftId: draft.id });
    }
  }
}

// ── Confirmar, cancelar e desfazer (pelo bot ou pela web) ───────────────────────

type ConfirmResult =
  | { ok: true; cents: Cents; title: string; installments: number | null; householdId: string }
  | { ok: false; reason: "STALE" | "INCOMPLETE" | "NOT_ALLOWED" };

/**
 * Confirma o rascunho: cria o lançamento pelo MESMO caminho do formulário (createTransaction ou
 * createInstallmentPurchase), com os crachás de agora, origem BOT e o id do rascunho como id na
 * origem (dois cliques no Confirmar nunca lançam duas vezes: a chave única do banco recusa).
 */
export async function confirmDraft(
  db: PrismaClient,
  userId: string,
  draftId: string,
  ctx: RequestContext,
  services: CascadeServices | undefined,
  now: Date = new Date(),
  today: CivilDate = todayCivil(now),
): Promise<ConfirmResult> {
  const draft = await db.botDraft.findFirst({
    where: { id: draftId, userId, status: "OPEN" },
    select: {
      id: true,
      householdId: true,
      walletId: true,
      accountId: true,
      cardId: true,
      method: true,
      amount: true,
      description: true,
      occurredOn: true,
      installmentCount: true,
      categoryId: true,
    },
  });
  if (!draft) return { ok: false, reason: "STALE" };
  if (!draft.walletId || !draft.accountId) return { ok: false, reason: "INCOMPLETE" };
  const [wallet, account, scope] = await Promise.all([
    authorizeWallet(db, userId, draft.walletId, "edit"),
    authorizeAccountUse(db, userId, draft.accountId),
    authorizeScope(db, userId, "view"),
  ]);
  if (!wallet.ok || !account.ok) return { ok: false, reason: "NOT_ALLOWED" };
  // Fecha o rascunho ANTES (corrida de dois Confirmar: um só passa daqui)
  const { count } = await db.botDraft.updateMany({
    where: { id: draft.id, status: "OPEN" },
    data: { status: "CONFIRMED", decidedAt: now },
  });
  if (count === 0) return { ok: false, reason: "STALE" };
  const cents = fromDbDecimal(draft.amount);
  const categoryId = draft.categoryId;
  const origin = { source: "BOT" as const, externalId: draft.id };
  try {
    let link: { transactionId?: string; installmentGroupId?: string };
    if (draft.installmentCount !== null) {
      const created = await createInstallmentPurchase(
        db,
        wallet.grant,
        account.grant,
        {
          cents,
          count: draft.installmentCount,
          description: draft.description,
          purchasedOn: civilFromDbDate(draft.occurredOn),
          categoryId,
          method: draft.method,
          cardId: draft.cardId,
          origin,
        },
        { scope, services },
        ctx,
        today,
      );
      link = { installmentGroupId: created.groupId };
    } else {
      const created = await createTransaction(
        db,
        wallet.grant,
        account.grant,
        {
          kind: "expense",
          cents,
          description: draft.description,
          occurredOn: civilFromDbDate(draft.occurredOn),
          categoryId,
          method: draft.method,
          cardId: draft.cardId,
          origin,
        },
        { scope, services },
        ctx,
      );
      link = { transactionId: created.id };
    }
    await db.$transaction(async (tx) => {
      await tx.botDraft.update({ where: { id: draft.id }, data: link });
      await writeAudit(
        tx,
        {
          actorId: userId,
          householdId: draft.householdId,
          action: "bot.entry_confirmed",
          entity: "bot_draft",
          entityId: draft.id,
          metadata: {
            walletId: draft.walletId,
            installments: draft.installmentCount,
            transactionId: link.transactionId ?? null,
            installmentGroupId: link.installmentGroupId ?? null,
          },
        },
        ctx,
      );
    });
  } catch (error) {
    // Não lançou (conta sem fechamento, categoria arquivada...): o rascunho volta a esperar
    await db.botDraft.updateMany({
      where: { id: draft.id, status: "CONFIRMED", transactionId: null, installmentGroupId: null },
      data: { status: "OPEN", decidedAt: null },
    });
    if (error instanceof DomainError) return { ok: false, reason: "NOT_ALLOWED" };
    throw error;
  }
  const category = categoryId
    ? await db.category.findUnique({ where: { id: categoryId }, select: { name: true } })
    : null;
  return {
    ok: true,
    cents,
    title: category?.name ?? draft.description,
    installments: draft.installmentCount,
    householdId: draft.householdId,
  };
}

/** Cancela um rascunho aberto. Nada foi lançado, então não há o que desfazer. */
export async function cancelDraft(
  db: PrismaClient,
  userId: string,
  draftId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const { count } = await db.botDraft.updateMany({
    where: { id: draftId, userId, status: "OPEN" },
    data: { status: "CANCELLED", decidedAt: now },
  });
  return count > 0;
}

/**
 * O Desfazer de um rascunho confirmado há menos de 30 minutos: o lançamento (ou todas as
 * parcelas) é excluído do jeito de sempre (exclusão lógica) e o rascunho fica UNDONE.
 */
export async function undoDraft(
  db: PrismaClient,
  userId: string,
  draftId: string,
  ctx: RequestContext,
  now: Date = new Date(),
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const draft = await tx.botDraft.findFirst({
      where: {
        id: draftId,
        userId,
        status: "CONFIRMED",
        decidedAt: { gte: new Date(now.getTime() - BOT_UNDO_MS) },
      },
      select: {
        id: true,
        householdId: true,
        walletId: true,
        transactionId: true,
        installmentGroupId: true,
      },
    });
    if (!draft) return false;
    // O lançamento precisa continuar editável por quem desfaz (o papel pode ter mudado)
    if (!draft.walletId) return false;
    const where = draft.installmentGroupId
      ? { installmentGroupId: draft.installmentGroupId }
      : draft.transactionId
        ? { id: draft.transactionId }
        : null;
    if (!where) return false;
    const access = await authorizeWallet(db, userId, draft.walletId, "edit");
    if (!access.ok) return false;
    const { count } = await tx.transaction.updateMany({
      where: { ...where, walletId: draft.walletId, deletedAt: null },
      data: { deletedAt: now },
    });
    await tx.botDraft.update({
      where: { id: draft.id },
      data: { status: "UNDONE", decidedAt: now },
    });
    await writeAudit(
      tx,
      {
        actorId: userId,
        householdId: draft.householdId,
        action: "bot.entry_undone",
        entity: "bot_draft",
        entityId: draft.id,
        metadata: { legs: count },
      },
      ctx,
    );
    return true;
  });
}

/** Os rascunhos abertos da pessoa (a seção "Do WhatsApp" em Recebidos). */
export async function openDrafts(db: PrismaClient, userId: string, now: Date = new Date()) {
  const rows = await db.botDraft.findMany({
    where: { userId, status: "OPEN" },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      createdAt: true,
      walletId: true,
      cardId: true,
      accountId: true,
      method: true,
      amount: true,
      description: true,
      occurredOn: true,
      installmentCount: true,
      categoryId: true,
    },
  });
  const choices = await botChoicesFor(db, userId);
  const categories = await db.category.findMany({
    where: { id: { in: rows.map((r) => r.categoryId).filter((id): id is string => !!id) } },
    select: { id: true, name: true },
  });
  return rows.map((row) => {
    const card = row.cardId ? choices.cards.find((c) => c.id === row.cardId) : null;
    const account = choices.debitAccounts.find((a) => a.id === row.accountId);
    return {
      id: row.id,
      createdAt: row.createdAt,
      expired: now.getTime() - row.createdAt.getTime() > BOT_DRAFT_TTL_MS,
      cents: fromDbDecimal(row.amount),
      description: row.description,
      occurredOn: civilFromDbDate(row.occurredOn),
      installments: row.installmentCount,
      method: row.method,
      category: categories.find((c) => c.id === row.categoryId)?.name ?? null,
      payWith: card?.nickname ?? account?.name ?? null,
      wallet: choices.wallets.find((w) => w.id === row.walletId)?.name ?? null,
      complete: row.walletId !== null && row.accountId !== null,
    };
  });
}

export type OpenDraft = Awaited<ReturnType<typeof openDrafts>>[number];

// ── A conta das respostas grátis ────────────────────────────────────────────────

/**
 * Reserva um lugar na conta do mês ANTES de mandar a resposta. Atômico: duas filas ao mesmo
 * tempo nunca passam do teto. `warn` diz se, junto, o aviso dos 850 deve sair (e já o reservou).
 */
export async function reserveReply(
  db: PrismaClient,
  phoneNumberId: string,
  kind: BotReplyKind,
  now: Date = new Date(),
): Promise<{ allowed: boolean; warn: boolean }> {
  const month = botMonth(now);
  await db.botReplyCount.createMany({
    data: [{ phoneNumberId, month, used: 0, updatedAt: now }],
    skipDuplicates: true,
  });
  // O essencial vai até 899; o resto só até 849
  const limit = isEssentialReply(kind) ? BOT_STOP_AT : BOT_WARN_AT;
  const reserved = await db.botReplyCount.updateMany({
    where: { phoneNumberId, month, used: { lt: limit } },
    data: { used: { increment: 1 }, updatedAt: now },
  });
  if (reserved.count === 0) return { allowed: false, warn: false };
  const warned = await db.botReplyCount.updateMany({
    where: {
      phoneNumberId,
      month,
      warnedAt: null,
      used: { gte: BOT_WARN_AT, lt: BOT_STOP_AT },
    },
    data: { used: { increment: 1 }, warnedAt: now, updatedAt: now },
  });
  return { allowed: true, warn: warned.count > 0 };
}

/** O texto do aviso dos 850 (o mesmo do core; aqui para quem manda não importar dois lugares). */
export const BOT_WARNING_MESSAGE = warningMessage();

/** Apaga as mensagens com mais de 90 dias (só o registro; os lançamentos ficam). */
export async function purgeBotMessages(db: PrismaClient, now: Date = new Date()): Promise<number> {
  const { count } = await db.botMessage.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - BOT_MESSAGE_RETENTION_DAYS * 86_400_000) } },
  });
  return count;
}
