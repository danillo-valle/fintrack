// O aviso no topo de Contas e cartões depois de criar uma conta ou um cartão (M12.3a, prancha
// J-Contas). Antes, o "Conta criada." aparecia no fim do formulário, no pé da página, e passava
// despercebido: a pessoa criava a mesma conta de novo. Agora a ação volta para a lista, o aviso
// vem em cima e a linha da conta fica marcada. Fechar é um link (funciona antes do React).
import Link from "next/link";
import { Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type CreatedNotice =
  | { kind: "account"; accountId: string; name: string; wallet: string; acceptsCards: boolean }
  | { kind: "card"; accountId: string; name: string; account: string; moved: number };

function movedText(moved: number) {
  if (moved === 1) return " 1 recebido do banco foi para ele.";
  if (moved > 1) return ` ${moved} recebidos do banco foram para ele.`;
  return "";
}

export function CreatedNoticeBanner({ notice }: { notice: CreatedNotice }) {
  return (
    <div
      role="status"
      data-testid="aviso-criado"
      className="bg-income/12 mb-5 flex flex-wrap items-center gap-3 rounded-2xl p-3.5 md:p-4"
    >
      <span className="bg-card text-income flex size-9 shrink-0 items-center justify-center rounded-xl">
        <Check aria-hidden className="size-5" />
      </span>
      <p className="min-w-0 flex-[1_1_15rem] text-[0.9375rem] leading-snug">
        {notice.kind === "account" ? (
          <>
            <strong className="break-words">
              Conta “{notice.name}” criada em {notice.wallet}.
            </strong>{" "}
            Ela está marcada na lista.{notice.acceptsCards ? " Agora cadastre o cartão." : ""}
          </>
        ) : (
          <>
            <strong className="break-words">
              Cartão “{notice.name}” cadastrado em {notice.account}.
            </strong>
            {movedText(notice.moved)}
          </>
        )}
      </p>
      {notice.kind === "account" && notice.acceptsCards ? (
        <Button asChild className="h-10 gap-1.5 rounded-xl px-4 font-bold">
          <Link href={`/ajustes/contas/${notice.accountId}/cartao`}>
            <Plus aria-hidden />
            Adicionar cartão
          </Link>
        </Button>
      ) : null}
      <Button asChild variant="ghost" size="icon" className="size-10 rounded-xl">
        <Link href="/ajustes/contas" aria-label="Fechar o aviso">
          <X aria-hidden />
        </Link>
      </Button>
    </div>
  );
}
