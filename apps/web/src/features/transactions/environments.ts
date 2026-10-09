// Os ambientes (carteiras) que a pessoa vê, para o seletor e a frase do resumo (M07.4, canvas C.2).
// Regras puras: a página e o Início usam as mesmas, a partir do que getTransactionsPage devolve.

export type Environment = { id: string; name: string; kind: "PERSONAL" | "SHARED" };

const byName = new Intl.Collator("pt-BR", { sensitivity: "base" });
const list = new Intl.ListFormat("pt-BR", { type: "conjunction" });

/**
 * Os ambientes do seletor, na ordem do canvas: os compartilhados primeiro (a "Casa" é o que se
 * olha mais), depois o pessoal; dentro de cada grupo, por nome. Arquivados não entram.
 */
export function environmentsOf(
  wallets: readonly (Environment & { archived: boolean })[],
): Environment[] {
  return wallets
    .filter((w) => !w.archived)
    .toSorted(
      (a, b) =>
        Number(a.kind === "PERSONAL") - Number(b.kind === "PERSONAL") ||
        byName.compare(a.name, b.name),
    )
    .map(({ id, name, kind }) => ({ id, name, kind }));
}

/**
 * A frase de "Tudo que vejo": quais ambientes a lista soma e, se houver outras pessoas no lar,
 * que o pessoal delas fica de fora. Por exemplo:
 *   "Somando os ambientes Casa e Bruna Prado. O ambiente pessoal de Caio não entra aqui."
 * Nula quando um ambiente está escolhido ou quando só há um (não há o que somar).
 */
export function environmentsSentence(
  environments: readonly Environment[],
  current: string | null,
  /** Os primeiros nomes das OUTRAS pessoas do lar */
  others: readonly string[],
): string | null {
  if (current !== null || environments.length < 2) return null;
  const summing = `Somando os ambientes ${list.format(environments.map((e) => e.name))}.`;
  if (others.length === 0) return summing;
  const names = list.format(others);
  return others.length === 1
    ? `${summing} O ambiente pessoal de ${names} não entra aqui.`
    : `${summing} Os ambientes pessoais de ${names} não entram aqui.`;
}
