// "Pago por" (M07.4, ADR-009): quem pagou um lançamento, para a lista mostrar DV, NV ou CP e para
// o filtro "Pago por" achar as compras de cada um.
//
// Não é uma coluna: sai do que o lançamento já guarda ("quem paga" do ADR-004).
//
//   tem cartão de compras conjuntas  →  Compartilhado
//   tem cartão com portador          →  o portador do cartão
//   sem cartão (Pix, débito, dinheiro) →  o titular da conta
//   nada disso                       →  desconhecido (a tela mostra a categoria no lugar)
//
// O mesmo critério vale em dois lugares: aqui, para mostrar, e no WHERE do banco
// (packages/db, payerWhere), para filtrar. O teste de integração confere que os dois concordam.

export type PayerSource = {
  card: { holderId: string | null; sharedPurchases: boolean } | null;
  account: { holderId: string | null };
};

export type Payer = { kind: "person"; userId: string } | { kind: "shared" } | { kind: "unknown" };

export function resolvePayer(source: PayerSource): Payer {
  if (source.card?.sharedPurchases) return { kind: "shared" };
  const userId = source.card ? source.card.holderId : source.account.holderId;
  return userId ? { kind: "person", userId } : { kind: "unknown" };
}

/** O filtro "Pago por" da URL: "compartilhado" ou o id de uma pessoa. */
export type PayerFilter = { kind: "shared" } | { kind: "person"; userId: string };

export const SHARED_PAYER_PARAM = "compartilhado";

export function parsePayerParam(value: string | null | undefined): PayerFilter | null {
  const text = value?.trim();
  if (!text) return null;
  if (text === SHARED_PAYER_PARAM) return { kind: "shared" };
  // Ids de pessoa são do Better Auth: letras, números, hífen e sublinhado
  return /^[A-Za-z0-9_-]{1,64}$/.test(text) ? { kind: "person", userId: text } : null;
}

export function payerParam(filter: PayerFilter): string {
  return filter.kind === "shared" ? SHARED_PAYER_PARAM : filter.userId;
}

/** As iniciais de um nome, em maiúsculas: "Danillo Valle" → "DV", "Ana" → "AN". */
export function initialsOf(name: string): string {
  const parts = name
    .normalize("NFC")
    .split(/\s+/)
    .filter((part) => /\p{L}/u.test(part));
  if (parts.length === 0) return "?";
  const letters = (word: string) => [...word].filter((c) => /\p{L}/u.test(c));
  const first = letters(parts[0]!);
  const last = parts.length > 1 ? letters(parts.at(-1)!) : [];
  const pair = last.length > 0 ? [first[0], last[0]] : first.slice(0, 2);
  return pair.join("").toLocaleUpperCase("pt-BR");
}

/** O primeiro nome, para etiquetas curtas: "Caio Moura" → "Caio". Sem nome: "". */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/** As iniciais de "Compartilhado". */
export const SHARED_INITIALS = "CP";

/**
 * A cor de cada pessoa em "Pago por": pela ordem em que entrou no lar, 1, 4, 3, 2 (azul,
 * laranja, rosa, verde); o tom 5 (verde-azulado) é sempre o do Compartilhado. Pela ordem, e não
 * por sorteio do id, para duas pessoas do mesmo lar nunca terem a mesma cor.
 */
export const SHARED_TONE = 5;
const PERSON_TONES = [1, 4, 3, 2] as const;

export function payerTones(memberIdsInJoinOrder: readonly string[]): Map<string, 1 | 2 | 3 | 4> {
  return new Map(
    memberIdsInJoinOrder.map((id, index) => [id, PERSON_TONES[index % PERSON_TONES.length]!]),
  );
}

/** Uma pessoa do lar como as telas a mostram: o nome, as iniciais e a cor dela no "Pago por". */
export type HouseholdPerson = {
  userId: string;
  name: string;
  /** O primeiro nome, para etiquetas curtas ("Caio") */
  firstName: string;
  initials: string;
  tone: 1 | 2 | 3 | 4;
};

/**
 * As pessoas do lar pela ordem em que entraram (é ela que decide a cor, payerTones), com as
 * iniciais. A mesma fonte para o "Pago por", quem usa cada cartão e quem está na sessão (M13.1):
 * a mesma pessoa tem a mesma cor e as mesmas letras em todas as telas.
 */
export function householdPeople(
  members: readonly { userId: string; joinedAt: Date; user: { name: string } }[],
): HouseholdPerson[] {
  const ordered = members.toSorted((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
  const tones = payerTones(ordered.map((m) => m.userId));
  return ordered.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    firstName: firstNameOf(m.user.name),
    initials: initialsOf(m.user.name),
    tone: tones.get(m.userId) ?? 1,
  }));
}
