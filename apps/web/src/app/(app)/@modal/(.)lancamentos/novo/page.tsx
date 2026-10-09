import { getQuickEntryPage } from "@/features/transactions/server/queries";
import {
  EntryModalActions,
  EntryWalletLabel,
} from "@/features/transactions/ui/entry/entry-actions";
import { EntryForm } from "@/features/transactions/ui/entry/entry-form";
import { EntryProvider } from "@/features/transactions/ui/entry/entry-provider";
import { RouteModal } from "@/components/ui/route-modal";
import { requireUser } from "@/lib/auth/session";
import { TEXT_LINK } from "@/lib/styles";

// Novo lançamento em modal (M07.1; layout do M07.3): quem clica em "Novo lançamento" em qualquer
// tela do app vê o formulário por cima da página, sem perder o lugar. A rota interceptada "(.)"
// só vale para a navegação dentro do app: recarregar ou abrir /lancamentos/novo direto mostra
// a página inteira (lancamentos/novo/page.tsx), com as mesmas peças.
//
// O EntryProvider fica POR FORA do modal: o subtítulo ("No ambiente Casa") e o rodapé fixo
// (Cancelar e Salvar) leem o mesmo estado do formulário.
export default async function NewTransactionModal() {
  const session = await requireUser(); // toda página do app começa conferindo a sessão
  const options = await getQuickEntryPage(session);
  const ready = options.wallets.length > 0 && options.accounts.length > 0;

  if (!ready) {
    return (
      <RouteModal title="Novo lançamento">
        <p className="text-sm">
          Para lançar, você precisa de um lar e de uma conta.{" "}
          {/* <a> comum, de propósito: recarrega e abre a página inteira, que explica o que falta.
              Um <Link> seria interceptado de novo e reabriria este mesmo modal. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/lancamentos/novo" className={TEXT_LINK}>
            Ver o que falta
          </a>
          .
        </p>
      </RouteModal>
    );
  }

  return (
    <EntryProvider options={options} idPrefix="modal-">
      <RouteModal
        title="Novo lançamento"
        description={<EntryWalletLabel />}
        initialFocus="#modal-amount"
        footer={<EntryModalActions />}
      >
        <EntryForm />
      </RouteModal>
    </EntryProvider>
  );
}
