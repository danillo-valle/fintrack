// As regras do bot do WhatsApp (M11, ADR-018) que não dependem de banco nem de rede: o código de
// vínculo, a guarda das respostas grátis, os botões e o texto exato de cada resposta.
//
// O texto das respostas mora aqui (e não na tela nem no adaptador) por um motivo de privacidade:
// a resposta passa pela Meta, então ela só pode repetir o que a pessoa mandou e o que o FinTrack
// decidiu sobre AQUELE lançamento (valor, data, descrição, categoria, ambiente, forma e o
// APELIDO do cartão). Nunca o final do cartão, saldo, total, orçamento ou outro lançamento. Os
// testes conferem cada texto contra essa lista.
import { type Cents } from "./money";
import { addDays, type CivilDate, monthKey, type MonthKey, parseCivilDate } from "./dates";

// ── Vínculo ─────────────────────────────────────────────────────────────────────

/** O código vale 10 minutos e uma vez só. */
export const BOT_LINK_CODE_TTL_MS = 10 * 60 * 1000;
/** Erros de código do mesmo número numa hora antes de ele ser ignorado por 24 h */
export const BOT_LINK_MAX_FAILURES = 5;
export const BOT_LINK_FAILURE_WINDOW_MS = 60 * 60 * 1000;
export const BOT_LINK_BLOCK_MS = 24 * 60 * 60 * 1000;

/** "vincular 482 913" → "482913". Qualquer outra coisa: nulo. */
export function parseLinkCommand(text: string): string | null {
  const match = /^\s*vincular\s+(\d{3})[\s.-]?(\d{3})\s*$/i.exec(text);
  return match ? `${match[1]}${match[2]}` : null;
}

/** O código como a tela mostra e a pessoa digita: "482 913". */
export function formatLinkCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/** Ignorar o número? (muitos códigos errados na última hora: 24 h de silêncio) */
export function linkBlocked(failuresAt: readonly Date[], now: Date): boolean {
  const recent = failuresAt.filter(
    (at) => now.getTime() - at.getTime() < BOT_LINK_FAILURE_WINDOW_MS,
  );
  if (recent.length >= BOT_LINK_MAX_FAILURES) return true;
  // O bloqueio dura 24 h a partir da quinta falha dentro de uma hora
  const sorted = [...failuresAt].sort((a, b) => a.getTime() - b.getTime());
  for (let i = BOT_LINK_MAX_FAILURES - 1; i < sorted.length; i++) {
    const first = sorted[i - (BOT_LINK_MAX_FAILURES - 1)]!;
    const fifth = sorted[i]!;
    if (
      fifth.getTime() - first.getTime() < BOT_LINK_FAILURE_WINDOW_MS &&
      now.getTime() - fifth.getTime() < BOT_LINK_BLOCK_MS
    )
      return true;
  }
  return false;
}

/** Os 4 últimos dígitos do número, para a tela ("final 0001"). Nunca o número inteiro. */
export function phoneLastFour(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) throw new Error("número de telefone curto demais");
  return digits.slice(-4);
}

/** O número no formato da Meta (só dígitos, com o país): "+55 41 9…" → "5541…". */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

// ── Respostas grátis ────────────────────────────────────────────────────────────

/** A Meta dá 1.000 respostas de serviço por mês ao número do bot (desde 1º/10/2026). */
export const BOT_FREE_TIER = 1000;
/** Aviso uma vez e, daí em diante, só o essencial */
export const BOT_WARN_AT = 850;
/** O bot para de responder até o mês virar */
export const BOT_STOP_AT = 900;

export type BotPhase = "NORMAL" | "ESSENTIAL" | "STOPPED";

export function botPhase(used: number): BotPhase {
  if (used >= BOT_STOP_AT) return "STOPPED";
  if (used >= BOT_WARN_AT) return "ESSENTIAL";
  return "NORMAL";
}

/**
 * O tipo de cada resposta. "Essencial" é o que a pessoa precisa para seguir (a proposta com os
 * botões, a pergunta, o vínculo, o "não entendi"); o resto ("Lançado", "Desfeito") vira o
 * "lida" (os dois tiques azuis), que não é mensagem e não custa nada.
 */
export type BotReplyKind =
  | "PROPOSAL"
  | "ASK"
  | "LINKED"
  | "NOT_UNDERSTOOD"
  | "WARNING"
  | "CONFIRMED"
  | "CANCELLED"
  | "UNDONE"
  | "EXPIRED";

const ESSENTIAL: ReadonlySet<BotReplyKind> = new Set([
  "PROPOSAL",
  "ASK",
  "LINKED",
  "NOT_UNDERSTOOD",
  "WARNING",
]);

export function isEssentialReply(kind: BotReplyKind): boolean {
  return ESSENTIAL.has(kind);
}

/**
 * Pode mandar esta resposta com `used` já mandadas no mês? A conta é sempre do número do bot (a
 * Meta conta por número comercial, não por pessoa). O teto é ANTES de mandar: a resposta de
 * número 900 nunca sai.
 */
export function replyAllowed(used: number, kind: BotReplyKind): boolean {
  const phase = botPhase(used);
  if (phase === "STOPPED") return false;
  if (phase === "ESSENTIAL") return isEssentialReply(kind);
  return true;
}

/** O aviso sai uma vez, na primeira resposta que leva a conta a 850. */
export function warningDue(usedBefore: number, warnedThisMonth: boolean): boolean {
  return !warnedThisMonth && usedBefore + 1 >= BOT_WARN_AT && usedBefore < BOT_STOP_AT;
}

const MONTH = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
});

/** O mês da conta, em São Paulo (a conta da Meta do FinTrack usa esse fuso; o manual confere). */
export function botMonth(now: Date): MonthKey {
  const parts = Object.fromEntries(MONTH.formatToParts(now).map((p) => [p.type, p.value]));
  return monthKey(Number.parseInt(parts.year ?? "0", 10), Number.parseInt(parts.month ?? "0", 10));
}

// ── Botões ──────────────────────────────────────────────────────────────────────

/** O que um botão faz. O id do botão volta no clique; nada além dele é confiável. */
export type BotAction =
  | { kind: "CONFIRM"; draftId: string }
  | { kind: "CANCEL"; draftId: string }
  | { kind: "UNDO"; draftId: string }
  | { kind: "PICK_CARD"; draftId: string; cardId: string }
  | { kind: "PICK_WALLET"; draftId: string; walletId: string };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ACTION = new RegExp(`^(c|x|u|k|w):(${UUID})(?::(${UUID}))?$`);

export function encodeAction(action: BotAction): string {
  switch (action.kind) {
    case "CONFIRM":
      return `c:${action.draftId}`;
    case "CANCEL":
      return `x:${action.draftId}`;
    case "UNDO":
      return `u:${action.draftId}`;
    case "PICK_CARD":
      return `k:${action.draftId}:${action.cardId}`;
    case "PICK_WALLET":
      return `w:${action.draftId}:${action.walletId}`;
  }
}

export function decodeAction(id: string): BotAction | null {
  const match = ACTION.exec(id);
  if (!match) return null;
  const [, kind, draftId, extra] = match as unknown as [string, string, string, string | undefined];
  if (kind === "c" && !extra) return { kind: "CONFIRM", draftId };
  if (kind === "x" && !extra) return { kind: "CANCEL", draftId };
  if (kind === "u" && !extra) return { kind: "UNDO", draftId };
  if (kind === "k" && extra) return { kind: "PICK_CARD", draftId, cardId: extra };
  if (kind === "w" && extra) return { kind: "PICK_WALLET", draftId, walletId: extra };
  return null;
}

/** O WhatsApp aceita até 3 botões de resposta, com até 20 caracteres no título. */
export const BOT_MAX_BUTTONS = 3;
export const BOT_BUTTON_TITLE_MAX = 20;

export function buttonTitle(text: string): string {
  return text.length <= BOT_BUTTON_TITLE_MAX ? text : `${text.slice(0, BOT_BUTTON_TITLE_MAX - 1)}…`;
}

/** Os botões de um rascunho valem 24 h (a janela de atendimento da Meta) */
export const BOT_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
/** O Desfazer pelo WhatsApp vale 30 min, como o da revisão na web (M09.2) */
export const BOT_UNDO_MS = 30 * 60 * 1000;

// ── O canal ─────────────────────────────────────────────────────────────────────

/**
 * O canal por onde as respostas saem (M11: a WhatsApp Cloud API; nos testes, a de mentira). A
 * leitura, o vínculo, a idempotência e a confirmação não conhecem o canal: só este contrato.
 */
export interface BotChannel {
  /** Manda a resposta (texto, ou texto com botões de resposta). Falha = lança. */
  send(to: string, message: BotMessage): Promise<void>;
  /** Marca a mensagem recebida como lida (os dois tiques azuis; não conta como mensagem) */
  markRead(wamid: string): Promise<void>;
}

// ── Textos ──────────────────────────────────────────────────────────────────────

export type BotMethodLabel = "crédito" | "débito" | "pix" | "dinheiro" | "boleto" | "vale";

/** O que a proposta mostra. Só o que a pessoa mandou e o que se decidiu sobre ESTE lançamento. */
export type BotProposalView = {
  cents: Cents;
  /** A categoria escolhida pela cascata; sem ela, a descrição */
  title: string;
  occurredOn: CivilDate;
  today: CivilDate;
  method: BotMethodLabel;
  /** Apelido do cartão ou nome da conta (nunca o final) */
  payWith: string;
  walletName: string;
  installments: number | null;
  /** O valor da parcela, quando parcelado */
  installmentCents: Cents | null;
};

export type BotMessage = {
  /** Linha em negrito (o WhatsApp usa *texto*) */
  header?: string;
  body: string;
  buttons?: { id: string; title: string }[];
};

/** R$ 1.234,56 sem depender do Intl (o mesmo formato da tela). */
export function brl(cents: Cents): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const units = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const rest = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}R$ ${units},${rest}`;
}

/** "Hoje, 21/10" · "Ontem, 20/10" · "19/10" · "19/12/2025" (outro ano). */
export function botDayLabel(date: CivilDate, today: CivilDate): string {
  const d = parseCivilDate(date);
  const t = parseCivilDate(today);
  const dm = `${String(d.day).padStart(2, "0")}/${String(d.month).padStart(2, "0")}`;
  if (date === today) return `Hoje, ${dm}`;
  if (date === addDays(today, -1)) return `Ontem, ${dm}`;
  return d.year === t.year ? dm : `${dm}/${d.year}`;
}

export function proposalMessage(view: BotProposalView, draftId: string): BotMessage {
  const amount =
    view.installments && view.installmentCents !== null
      ? `${brl(view.cents)} em ${view.installments}x de ${brl(view.installmentCents)}`
      : brl(view.cents);
  return {
    header: "Lançar assim?",
    body: [
      `${amount} · ${view.title}`,
      `${botDayLabel(view.occurredOn, view.today)} · ${view.method}, ${view.payWith}`,
      `Ambiente: ${view.walletName}`,
    ].join("\n"),
    buttons: [
      { id: encodeAction({ kind: "CONFIRM", draftId }), title: "Confirmar" },
      { id: encodeAction({ kind: "CANCEL", draftId }), title: "Cancelar" },
    ],
  };
}

export function askCardMessage(
  view: { cents: Cents; title: string },
  draftId: string,
  cards: readonly { id: string; nickname: string }[],
): BotMessage {
  return {
    header: "Em qual cartão?",
    body: `${brl(view.cents)} · ${view.title}`,
    buttons: cards.slice(0, BOT_MAX_BUTTONS).map((card) => ({
      id: encodeAction({ kind: "PICK_CARD", draftId, cardId: card.id }),
      title: buttonTitle(card.nickname),
    })),
  };
}

export function askWalletMessage(
  view: { cents: Cents; title: string },
  draftId: string,
  wallets: readonly { id: string; name: string }[],
): BotMessage {
  return {
    header: "Em qual ambiente?",
    body: `${brl(view.cents)} · ${view.title}`,
    buttons: wallets.slice(0, BOT_MAX_BUTTONS).map((wallet) => ({
      id: encodeAction({ kind: "PICK_WALLET", draftId, walletId: wallet.id }),
      title: buttonTitle(wallet.name),
    })),
  };
}

export function confirmedMessage(
  view: { cents: Cents; title: string; installments: number | null },
  draftId: string,
): BotMessage {
  const amount = view.installments
    ? `${brl(view.cents)} em ${view.installments}x`
    : brl(view.cents);
  return {
    body: `Lançado: ${amount}, ${view.title}.`,
    buttons: [{ id: encodeAction({ kind: "UNDO", draftId }), title: "Desfazer" }],
  };
}

export const CANCELLED_MESSAGE: BotMessage = { body: "Cancelado. Nada foi lançado." };
export const UNDONE_MESSAGE: BotMessage = { body: "Desfeito. Nada ficou lançado." };
export const UNDO_EXPIRED_MESSAGE: BotMessage = {
  body: "Passou de 30 minutos. Para desfazer, abra o lançamento no FinTrack.",
};
export const EXPIRED_MESSAGE: BotMessage = {
  body: "Essa proposta passou de 24 horas e está em Recebidos, no FinTrack.",
};
export const ALREADY_DONE_MESSAGE: BotMessage = {
  body: "Essa proposta já foi decidida, aqui ou no FinTrack.",
};

export function linkedMessage(firstName: string, walletName: string): BotMessage {
  return {
    body: [
      `Pronto, ${firstName}. Seu número está vinculado.`,
      "Para lançar, escreva por exemplo: gastei 42,90 no mercado",
      `Vai para o ambiente ${walletName}; troque em Ajustes › Bot do WhatsApp.`,
    ].join("\n"),
  };
}

export function warningMessage(): BotMessage {
  return {
    body: `Aviso: o bot chegou a ${BOT_WARN_AT} respostas grátis neste mês. Até o mês virar ele só manda a proposta; a confirmação aparece como “lida”.`,
  };
}

/** A resposta para cada leitura que falhou (sem repetir nada do que veio). */
export function notUnderstoodMessage(
  error:
    | "EMPTY"
    | "TOO_LONG"
    | "CARD_NUMBER"
    | "NO_AMOUNT"
    | "MANY_AMOUNTS"
    | "ZERO_AMOUNT"
    | "AMOUNT_TOO_BIG"
    | "BAD_DATE"
    | "FUTURE_DATE"
    | "BAD_INSTALLMENTS"
    | "NO_DESCRIPTION"
    | "NO_ACCOUNT"
    | "NOT_A_TEXT",
): BotMessage {
  const EXAMPLE = "gastei 42,90 no mercado";
  const text: Record<typeof error, string> = {
    EMPTY: `Não entendi. Escreva assim:\n${EXAMPLE}`,
    TOO_LONG: `A mensagem é longa demais. Escreva assim:\n${EXAMPLE}`,
    CARD_NUMBER:
      "Isso parece um número de cartão. Apaguei a mensagem sem guardar nada. Mande só o apelido do cartão, como “no visa”.",
    NO_AMOUNT: `Não achei o valor. Escreva assim:\n${EXAMPLE}`,
    MANY_AMOUNTS: "Achei mais de um valor. Mande um lançamento por mensagem, com um valor só.",
    ZERO_AMOUNT: "O valor não pode ser zero.",
    AMOUNT_TOO_BIG: "Esse valor é grande demais para lançar por aqui. Use o FinTrack na web.",
    BAD_DATE: "Não entendi a data. Use hoje, ontem, dia 19 ou 19/10.",
    FUTURE_DATE: "A data está no futuro. Lançamento agendado só pela web.",
    BAD_INSTALLMENTS: "Parcelas pelo bot: de 2 a 24 vezes, como “em 3x”.",
    NO_DESCRIPTION: `Faltou dizer o que foi. Escreva assim:\n${EXAMPLE}`,
    NO_ACCOUNT:
      "Não sei em qual ambiente, conta ou cartão lançar. Escolha os padrões em Ajustes › Bot do WhatsApp.",
    NOT_A_TEXT: "Por enquanto o bot só lê texto. Mande o lançamento escrito.",
  };
  return { body: text[error] };
}

/**
 * A mensagem tinha valor, mas o que sobrava era o nome de um ambiente ou cartão (M12.0): diz o
 * que foi entendido. Só nomes que a própria pessoa usa (o ambiente e o apelido do cartão).
 */
export function nameOnlyMessage(named: { wallet: string | null; card: string | null }): BotMessage {
  const parts = [
    named.wallet ? `o ambiente “${named.wallet}”` : null,
    named.card ? `o cartão “${named.card}”` : null,
  ].filter((part): part is string => part !== null);
  const what = parts.length > 0 ? parts.join(" e ") : "o ambiente";
  return {
    body: `Entendi ${what}, mas faltou dizer o que foi. Escreva assim:\ngastei 42,90 no mercado`,
  };
}

/** Todos os textos fixos, para os testes de privacidade conferirem de uma vez. */
export const BOT_FIXED_MESSAGES: readonly BotMessage[] = [
  CANCELLED_MESSAGE,
  UNDONE_MESSAGE,
  UNDO_EXPIRED_MESSAGE,
  EXPIRED_MESSAGE,
  ALREADY_DONE_MESSAGE,
];

// ── Para onde vai o lançamento ──────────────────────────────────────────────────

export type BotCardOption = {
  id: string;
  nickname: string;
  accountId: string;
  /** Cartão de crédito (conta CREDIT_CARD) ou de débito (corrente) */
  credit: boolean;
};

export type BotDefaults = {
  walletId: string | null;
  debitAccountId: string | null;
  creditCardId: string | null;
};

export type BotOptions = {
  /** Os ambientes em que a pessoa pode lançar */
  walletIds: readonly string[];
  cards: readonly BotCardOption[];
  /** Contas correntes e poupanças em que a pessoa pode lançar (débito e pix) */
  debitAccountIds: readonly string[];
};

export type BotWalletChoice =
  { kind: "WALLET"; walletId: string } | { kind: "ASK"; walletIds: string[] } | { kind: "NONE" };

/**
 * O ambiente: o que a mensagem citou; senão o padrão da pessoa; senão o único que ela tem.
 * Dois ou três possíveis: pergunta por botão. Mais que isso, sem padrão: pede o padrão.
 */
export function chooseBotWallet(
  mentioned: readonly string[],
  defaults: BotDefaults,
  options: BotOptions,
): BotWalletChoice {
  const allowed = mentioned.filter((id) => options.walletIds.includes(id));
  if (allowed.length === 1) return { kind: "WALLET", walletId: allowed[0]! };
  if (allowed.length > 1) return { kind: "ASK", walletIds: allowed.slice(0, BOT_MAX_BUTTONS) };
  if (defaults.walletId && options.walletIds.includes(defaults.walletId))
    return { kind: "WALLET", walletId: defaults.walletId };
  if (options.walletIds.length === 1) return { kind: "WALLET", walletId: options.walletIds[0]! };
  if (options.walletIds.length > 1 && options.walletIds.length <= BOT_MAX_BUTTONS)
    return { kind: "ASK", walletIds: [...options.walletIds] };
  return { kind: "NONE" };
}

export type BotPaymentChoice =
  | { kind: "PAY"; method: "CREDIT" | "DEBIT" | "PIX"; accountId: string; cardId: string | null }
  | { kind: "ASK"; cardIds: string[] }
  | { kind: "NONE" };

/**
 * Quem paga: o cartão citado; senão a forma citada com a conta ou o cartão padrão; sem forma, o
 * cartão de crédito padrão e, sem ele, a conta padrão. Parcelado é sempre no crédito.
 */
export function chooseBotPayment(
  entry: {
    method: "CREDIT" | "DEBIT" | "PIX" | null;
    installments: number | null;
    cardIds: readonly string[];
  },
  defaults: BotDefaults,
  options: BotOptions,
): BotPaymentChoice {
  const card = (id: string) => options.cards.find((c) => c.id === id) ?? null;
  const credit = options.cards.filter((c) => c.credit);
  const payWithCard = (c: BotCardOption): BotPaymentChoice =>
    entry.installments !== null && !c.credit
      ? { kind: "NONE" }
      : {
          kind: "PAY",
          method: c.credit ? "CREDIT" : "DEBIT",
          accountId: c.accountId,
          cardId: c.id,
        };
  const askOrNone = (list: readonly BotCardOption[]): BotPaymentChoice =>
    list.length >= 2 && list.length <= BOT_MAX_BUTTONS
      ? { kind: "ASK", cardIds: list.map((c) => c.id) }
      : { kind: "NONE" };
  const creditChoice = (): BotPaymentChoice => {
    const preferred = defaults.creditCardId ? card(defaults.creditCardId) : null;
    if (preferred?.credit) return payWithCard(preferred);
    if (credit.length === 1) return payWithCard(credit[0]!);
    return askOrNone(credit);
  };
  const debitAccount = (): string | null => {
    if (defaults.debitAccountId && options.debitAccountIds.includes(defaults.debitAccountId))
      return defaults.debitAccountId;
    return options.debitAccountIds.length === 1 ? options.debitAccountIds[0]! : null;
  };

  const mentioned = entry.cardIds.map(card).filter((c): c is BotCardOption => c !== null);
  if (mentioned.length === 1) return payWithCard(mentioned[0]!);
  if (mentioned.length > 1) return askOrNone(mentioned);
  if (entry.method === "CREDIT" || entry.installments !== null) return creditChoice();
  if (entry.method === "DEBIT" || entry.method === "PIX") {
    const accountId = debitAccount();
    return accountId
      ? { kind: "PAY", method: entry.method, accountId, cardId: null }
      : { kind: "NONE" };
  }
  // Sem forma: o crédito padrão; sem ele, o débito padrão; sem padrões, o único que houver
  const preferred = defaults.creditCardId ? card(defaults.creditCardId) : null;
  if (preferred?.credit) return payWithCard(preferred);
  if (defaults.debitAccountId && options.debitAccountIds.includes(defaults.debitAccountId))
    return { kind: "PAY", method: "DEBIT", accountId: defaults.debitAccountId, cardId: null };
  if (credit.length === 1) return payWithCard(credit[0]!);
  if (credit.length === 0 && options.debitAccountIds.length === 1)
    return { kind: "PAY", method: "DEBIT", accountId: options.debitAccountIds[0]!, cardId: null };
  return askOrNone(credit);
}
