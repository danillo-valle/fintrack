"use client";

// O formulário de lançamento numa página (M07; estrutura do M07.3): o lançamento rápido em
// /lancamentos/novo e a edição em /lancamentos/[id]. No modal, a página do @modal monta as
// mesmas peças em volta do RouteModal (o rodapé fixo e o subtítulo leem o mesmo estado).
//
// Lançamento rápido em três toques: valor, descrição, salvar. O resto já vem preenchido: a
// categoria SUGERIDA pela cascata (regra → histórico), o "pago com" e o ambiente do último
// lançamento e a data de hoje. A sugestão é só uma ajuda: ao salvar, o servidor roda a cascata DE
// NOVO para saber se a pessoa aceitou (categorizedBy) ou corrigiu (exemplo de treino).
import { EntrySubmit } from "./entry/entry-actions";
import { EntryForm } from "./entry/entry-form";
import { EntryProvider, type EntryOptions, type ExistingTransaction } from "./entry/entry-provider";

export type { EntryOptions, ExistingTransaction } from "./entry/entry-provider";

export function TransactionForm({
  options,
  existing,
}: {
  options: EntryOptions;
  existing?: ExistingTransaction;
}) {
  return (
    <EntryProvider options={options} existing={existing}>
      <div className="flex max-w-2xl flex-col gap-5">
        <EntryForm />
        <div>
          <EntrySubmit />
        </div>
      </div>
    </EntryProvider>
  );
}
