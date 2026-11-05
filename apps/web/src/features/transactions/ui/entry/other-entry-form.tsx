// As abas Transferência e Recorrência do Novo lançamento (M13.3a): os formulários de sempre (M07),
// agora dentro do mesmo modal e da mesma página. Só entram na transferência as contas que a pessoa
// administra pela carteira: o portador de um cartão adicional não move dinheiro da conta do titular.
import Link from "next/link";
import { TEXT_LINK } from "@/lib/styles";
import type { getQuickEntryPage } from "../../server/queries";
import { RecurrenceForm } from "../recurrence-form";
import { TransferForm } from "../transfer-form";

type Options = Awaited<ReturnType<typeof getQuickEntryPage>>;

export function OtherEntryForm({
  tab,
  options,
}: {
  tab: "transferencia" | "recorrencia";
  options: Options;
}) {
  if (tab === "transferencia") {
    const own = options.accounts.filter((a) => a.via === "WALLET");
    if (own.length < 2) {
      return (
        <p className="text-sm">
          Para transferir, cadastre pelo menos duas contas (a corrente e a poupança, por exemplo) em{" "}
          <Link href="/ajustes/contas" className={TEXT_LINK}>
            Contas e cartões
          </Link>
          .
        </p>
      );
    }
    return (
      <div className="flex flex-col gap-3">
        <TransferForm accounts={own} today={options.defaults.occurredOn} />
        <p className="text-muted-foreground text-sm">
          Os dois lados ficam ligados, sem categoria e fora das somas de gasto e de receita.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <RecurrenceForm
        wallets={options.wallets}
        accounts={options.accounts}
        categories={options.categories}
        defaults={options.defaults}
      />
      <p className="text-muted-foreground text-sm">
        Fica em{" "}
        <Link href="/fixas" className={TEXT_LINK}>
          Fixas e parcelas
        </Link>
        , onde dá para lançar as do mês e encerrar.
      </p>
    </div>
  );
}
