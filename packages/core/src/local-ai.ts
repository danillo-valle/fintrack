// A IA local (M10.2b, ADR-016): as regras puras da camada 5 da cascata.
//
// Ela NÃO é uma camada síncrona como as outras quatro: não roda quando a pessoa lança, nem na
// busca do banco. Roda numa fila, na janela da noite, e só para o que sobrou:
//
//   recebido de uma CARGA do banco (Meu Pluggy, OFX, fatura PDF), ainda PENDING, sem categoria,
//   sem par, que a IA ainda não viu, num lar com a IA ligada
//
// O lançamento feito à mão nunca vai para a IA (decisão de 17/10). A resposta da IA é uma
// categoria da lista do lar, uma categoria NOVA proposta (nome e mãe, que a pessoa cria com um
// clique), "nenhuma", BARRADA pelo filtro ou INVÁLIDA (fora do schema). Nada vale sem a pessoa
// confirmar nos Recebidos.
import { normalizeText } from "./categorization";

/** O valor de `categorizedBy` de uma categoria que veio da IA local. */
export const LOCAL_AI_SOURCE = "LLM" as const;

/** De onde vem o que a IA pode ver: só as cargas do banco, nunca o lançamento manual. */
export const LOCAL_AI_BULK_SOURCES = ["OPEN_FINANCE", "OFX", "PDF"] as const;

/** O teto de uso (não há API paga, então não há teto em reais): por lar, por noite. */
export const LOCAL_AI_NIGHT_LIMIT = 200;

export const LOCAL_AI_TIME_ZONE = "America/Sao_Paulo";
/**
 * A janela em que a fila pergunta à IA (o container sobe às 04:40 e desce às 06:45, pelos
 * timers do servidor): depois do treino do classificador (03:15), do backup (03:30) e da busca
 * do Meu Pluggy (04:30), com folga nas pontas.
 */
export const LOCAL_AI_WINDOW = {
  start: { hour: 4, minute: 45 },
  end: { hour: 6, minute: 40 },
} as const;
/** O texto da janela na tela (o tempo em que a IA está no ar). */
export const LOCAL_AI_WINDOW_TEXT = "das 04:45 às 06:45";
/** A "noite" que o teto conta começa às 04:00 (antes da janela, depois do backup). */
const NIGHT_STARTS_AT = { hour: 4, minute: 0 };

export type LocalAiOutcome = "SUGGESTED" | "NEW_CATEGORY" | "NO_SUGGESTION" | "BLOCKED" | "INVALID";

export type LocalAiAnswer =
  | { outcome: "SUGGESTED"; category: string }
  | { outcome: "NEW_CATEGORY"; name: string; parent: string | null }
  | { outcome: "NO_SUGGESTION" | "BLOCKED" | "INVALID" };

/** O que vai para a IA: a descrição, o tipo e os NOMES das categorias do lar daquele tipo. */
export type LocalAiQuestion = {
  description: string;
  kind: "expense" | "income";
  /** Todas as categorias ativas do tipo (mães e filhas) */
  categories: readonly string[];
  /** As de primeiro nível, onde uma categoria nova pode entrar */
  parents: readonly string[];
};

/**
 * A porta da IA local (padrão adaptador): o app fala HTTP com o serviço Python, que é o único
 * que fala com o llama-server. Nos testes, uma porta falsa.
 */
export interface LocalAiPort {
  /** O llama-server está no ar e com o modelo carregado? (fora da janela: false) */
  ready(): Promise<boolean>;
  /** Lança LocalAiUnavailable se a IA saiu do ar no meio (fim da janela, queda). */
  suggest(question: LocalAiQuestion): Promise<LocalAiAnswer>;
}

export class LocalAiUnavailable extends Error {
  constructor(message = "LOCAL_AI_UNAVAILABLE") {
    super(message);
    this.name = "LocalAiUnavailable";
  }
}

// ── O relógio de São Paulo ──────────────────────────────────────────────────────

const CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: LOCAL_AI_TIME_ZONE,
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Hora, minuto e segundo em São Paulo (o servidor pode estar em UTC). */
export function saoPauloClock(date: Date): { hour: number; minute: number; second: number } {
  const parts = Object.fromEntries(
    CLOCK.formatToParts(date)
      .filter((p) => p.type === "hour" || p.type === "minute" || p.type === "second")
      .map((p) => [p.type, Number.parseInt(p.value, 10)]),
  );
  return { hour: parts.hour ?? 0, minute: parts.minute ?? 0, second: parts.second ?? 0 };
}

const minutesOf = (t: { hour: number; minute: number }) => t.hour * 60 + t.minute;

/** Agora é hora de perguntar à IA? (04:45 até 06:40, horário de São Paulo) */
export function inLocalAiWindow(date: Date): boolean {
  const now = minutesOf(saoPauloClock(date));
  return now >= minutesOf(LOCAL_AI_WINDOW.start) && now < minutesOf(LOCAL_AI_WINDOW.end);
}

/** O instante em que a janela de hoje fecha (06:40 de São Paulo): o limite da rodada da fila. */
export function localAiWindowEnd(date: Date): Date {
  const clock = saoPauloClock(date);
  const left = (minutesOf(LOCAL_AI_WINDOW.end) - minutesOf(clock)) * 60 - clock.second;
  const end = new Date(date.getTime() + left * 1000);
  end.setUTCMilliseconds(0);
  return end;
}

/** O instante em que a noite de `date` começou (04:00 de São Paulo, hoje ou ontem). */
export function localAiNightStart(date: Date): Date {
  const clock = saoPauloClock(date);
  let elapsed = (minutesOf(clock) - minutesOf(NIGHT_STARTS_AT)) * 60 + clock.second;
  if (elapsed < 0) elapsed += 24 * 60 * 60;
  const start = new Date(date.getTime() - elapsed * 1000);
  start.setUTCMilliseconds(0);
  return start;
}

// ── A categoria nova ────────────────────────────────────────────────────────────

const LETTERS = "A-Za-zÀ-ÖØ-öø-ÿ";
/** O nome proposto (o mesmo padrão do schema da IA e do CHECK do banco). */
export const PROPOSAL_NAME = new RegExp(`^[${LETTERS}]{2,20}( [${LETTERS}]{1,20}){0,2}$`, "u");
export const PROPOSAL_NAME_MAX = 30;

/** 1 a 3 palavras, só letras e um espaço entre elas, até 30 caracteres. */
export function isProposalName(name: string): boolean {
  return name.length <= PROPOSAL_NAME_MAX && PROPOSAL_NAME.test(name);
}

/** Para comparar nomes de categoria: sem acento, sem diferença de maiúscula. */
export function categoryNameKey(name: string): string {
  return normalizeText(name);
}
