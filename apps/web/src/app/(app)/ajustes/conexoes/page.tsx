import type { Metadata } from "next";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  History,
  Info,
  Link2,
  Plus,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { SurfaceList } from "@/components/visual/surface-list";
import { ToneChip } from "@/components/visual/tone-chip";
import { getConnectionsPage } from "@/features/bank/server/queries";
import { providerErrorMessage } from "@/features/bank/messages";
import { requireUser } from "@/lib/auth/session";
import { TEXT_LINK } from "@/lib/styles";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Conexões bancárias" };

// Ajustes › Conexões bancárias (M09.1, fundo das pranchas E-Conectar e E-Ligar): a conexão do
// Meu Pluggy de QUEM ESTÁ LOGADO. Cada pessoa conecta só as próprias contas (regra do Meu Pluggy);
// ninguém vê as credenciais nem o histórico do outro.
export default async function ConnectionsPage() {
  const session = await requireUser(); // toda página do app começa conferindo a sessão
  const page = await getConnectionsPage(session);
  const firstName = session.user.name.split(" ")[0] ?? session.user.name;
  const connection = page.connection;
  const ready = connection && connection.hasSecret && connection.items.length > 0;
  const linked = ready && connection.importFrom !== null;
  const failed = connection?.status === "ERROR";

  return (
    <>
      <nav aria-label="Caminho" className="mb-1">
        <Link
          href="/ajustes"
          className={cn(TEXT_LINK, "inline-flex min-h-8 items-center gap-1 text-sm")}
        >
          <ChevronLeft aria-hidden className="size-4" />
          Ajustes
        </Link>
      </nav>
      <PageHeader
        help="meu-pluggy"
        title="Conexões bancárias"
        description="Cada pessoa conecta só as próprias contas, com a própria conta do Meu Pluggy."
      />
      <div className="flex max-w-3xl flex-col gap-4">
        {!page.ready ? (
          <p
            role="status"
            className="bg-expense/10 grid grid-cols-[1.375rem_minmax(0,1fr)] gap-2.5 rounded-xl p-3 text-sm"
          >
            <CircleAlert aria-hidden className="text-expense size-5" />
            <span>
              O servidor ainda não tem a chave que protege as credenciais (
              <code>CONNECTION_SECRET_KEYS</code>). Sem ela, não dá para conectar. Quem cuida do
              servidor resolve em um passo.
            </span>
          </p>
        ) : null}
        {!page.grant ? (
          <p className="text-muted-foreground text-sm">
            Crie o seu lar em Carteiras antes de conectar um banco.
          </p>
        ) : (
          <section
            aria-labelledby="meu-pluggy"
            className="bg-card flex flex-wrap items-center gap-4 rounded-[1.25rem] border p-4 md:p-5"
          >
            <span
              aria-hidden
              className="text-chart-1-ink grid size-11 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--chart-1)_16%,transparent)]"
            >
              <Link2 className="size-[1.375rem]" />
            </span>
            <span className="flex min-w-0 flex-[1_1_16rem] flex-col gap-0.5">
              <strong id="meu-pluggy" className="text-[1.0625rem]">
                Meu Pluggy de {firstName}
              </strong>
              <span className="text-muted-foreground text-sm">
                Gratuito para uso pessoal · até 5 bancos · só contas em nome de {firstName}
              </span>
            </span>
            {failed ? (
              <ToneChip tone={3} icon={CircleAlert}>
                Credenciais recusadas
              </ToneChip>
            ) : ready ? (
              <ToneChip tone={5} icon={CircleCheck}>
                Conectado · {connection.items.length}{" "}
                {connection.items.length === 1 ? "banco" : "bancos"}
              </ToneChip>
            ) : (
              <ToneChip tone={4} icon={Info}>
                Não conectado
              </ToneChip>
            )}
            <Button asChild className="h-11 gap-2 rounded-xl px-[1.125rem] text-sm font-bold">
              <Link href="/ajustes/conexoes/credenciais">
                <Plus aria-hidden />
                {ready ? "Trocar credenciais" : "Conectar o Meu Pluggy"}
              </Link>
            </Button>
            {failed ? (
              <p className="text-sm md:basis-full">
                {providerErrorMessage("PROVIDER_AUTH_FAILED")}
              </p>
            ) : null}
          </section>
        )}

        {ready ? (
          <nav aria-label="Conexão">
            <SurfaceList>
              <li>
                <Link
                  href="/ajustes/conexoes/ligar"
                  className="hover:bg-muted focus-visible:ring-ring flex min-h-14 items-center gap-3 px-4 py-3 outline-none focus-visible:ring-3"
                >
                  <Link2 aria-hidden className="text-chart-1-ink size-5" />
                  <span className="flex flex-1 flex-col">
                    <strong className="text-[0.9375rem]">
                      {linked ? "Contas ligadas" : "Ligar as contas"}
                    </strong>
                    <span className="text-muted-foreground text-sm">
                      {linked
                        ? `${connection.accounts.length} ${connection.accounts.length === 1 ? "conta" : "contas"} · importando desde ${connection.importFrom?.split("-").reverse().join("/")}`
                        : "Diga onde cada conta do banco entra no FinTrack"}
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="size-[1.125rem]" />
                </Link>
              </li>
              {linked ? (
                <li>
                  <Link
                    href="/ajustes/conexoes/sincronizacoes"
                    className="hover:bg-muted focus-visible:ring-ring flex min-h-14 items-center gap-3 px-4 py-3 outline-none focus-visible:ring-3"
                  >
                    <History aria-hidden className="text-chart-5-ink size-5" />
                    <span className="flex flex-1 flex-col">
                      <strong className="text-[0.9375rem]">Sincronizações</strong>
                      <span className="text-muted-foreground text-sm">
                        Cada busca no banco fica registrada
                      </span>
                    </span>
                    <ChevronRight aria-hidden className="size-[1.125rem]" />
                  </Link>
                </li>
              ) : null}
            </SurfaceList>
          </nav>
        ) : null}

        <section
          aria-labelledby="antes"
          className="bg-card flex flex-col gap-3 rounded-[1.25rem] border p-4 md:p-5"
        >
          <h2 id="antes" className="text-xl font-extrabold">
            Antes de começar
          </h2>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-[0.9375rem]">
            <li>Crie a sua conta no Meu Pluggy e conecte os seus bancos lá.</li>
            <li>
              No painel da Pluggy, conecte o item Meu Pluggy e copie o código (Item ID) de cada
              banco.
            </li>
            <li>
              Copie o Client ID e o Client Secret da sua aplicação. Você digita os dois aqui;
              ninguém mais vê.
            </li>
          </ol>
        </section>
      </div>
    </>
  );
}
