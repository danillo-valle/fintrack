import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Info, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Note } from "@/components/visual/note";
import { getPreviewPage } from "@/features/bank/server/imports";
import { AccountPicker } from "@/features/bank/ui/import/account-picker";
import { ImportFooter } from "@/features/bank/ui/import/import-footer";
import {
  ImportTiles,
  InvoiceSettlement,
  InvoiceSummary,
  PREVIEW_ROWS,
  PreviewRows,
  PreviewSummary,
} from "@/features/bank/ui/import/preview-parts";
import { SMALL_BUTTON } from "@/features/bank/ui/review/parts";
import { requireUser } from "@/lib/auth/session";
import { dayAndTime } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { TEXT_LINK } from "@/lib/styles";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Conferir antes de importar" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// Importar extrato, passo 2 (M09.3, pranchas E3-Conferir, E3-Cartao e E3-CelConferir; M09.4,
// E4-Conferir, E4-NaoConfere e E4-CelConferir): o resumo do arquivo, a conta em que ele entra
// (?conta=), a fatura do PDF conferida ao centavo, o que acontece com cada linha e o "Importar".
// A conferência é só de quem enviou: de outra pessoa, vencida ou já importada, 404.
export default async function ConferPage({
  params,
  searchParams,
}: PageProps<"/lancamentos/importar/[importId]">) {
  const session = await requireUser(); // toda página do app começa conferindo a sessão
  const { importId } = await params;
  const chosen = one((await searchParams).conta) ?? null;
  const page = await getPreviewPage(session, importId, chosen);
  if (!page) notFound();

  const isCard = page.statementKind === "CREDIT_CARD";
  const total = page.rows.length;
  const shown = Math.min(total, PREVIEW_ROWS);
  const previous = page.alreadyImported ? dayAndTime(page.alreadyImported.at) : null;
  const invoice = page.invoice;
  const off = invoice && !invoice.matches ? invoice.difference : null;

  return (
    <>
      <PageHeader
        help="importar"
        crumb={{
          href: "/lancamentos/recebidos",
          label: "Recebidos do banco",
          trail: "Lançamentos",
        }}
        title="Importar extrato"
        description="Passo 2 de 2: confira antes de importar."
      />

      {page.alreadyImported && previous ? (
        <div
          role="status"
          data-testid="aviso-repetido"
          className="mb-4 grid grid-cols-[1.375rem_minmax(0,1fr)] items-center gap-3 rounded-2xl border bg-[color-mix(in_srgb,var(--chart-4)_14%,transparent)] px-4 py-3.5 md:mb-5 md:grid-cols-[1.375rem_minmax(0,1fr)_auto]"
        >
          <TriangleAlert aria-hidden className="text-chart-4-ink size-[1.375rem]" />
          <p className="text-sm">
            Este arquivo já foi importado em{" "}
            <strong>
              {previous.day} às {previous.time}
            </strong>
            {page.alreadyImported.accountName ? `, na ${page.alreadyImported.accountName}` : ""}.
            Importar de novo não cria nada repetido: o que já entrou fica de fora.
          </p>
          <Link
            href="/lancamentos/importar"
            className={cn(SMALL_BUTTON, "col-span-2 md:col-span-1")}
          >
            Escolher outro arquivo
          </Link>
        </div>
      ) : null}

      {off !== null ? (
        <div
          role="status"
          data-testid="aviso-nao-confere"
          className="mb-4 grid grid-cols-[1.375rem_minmax(0,1fr)] items-center gap-3 rounded-2xl border bg-[color-mix(in_srgb,var(--chart-4)_14%,transparent)] px-4 py-3.5 md:mb-5 md:grid-cols-[1.375rem_minmax(0,1fr)_auto]"
        >
          <TriangleAlert aria-hidden className="text-chart-4-ink size-[1.375rem]" />
          <p className="text-sm">
            A soma não fecha:{" "}
            <strong>
              {off > 0n ? "faltam" : "sobram"} {formatBRL(off > 0n ? off : -off)}
            </strong>{" "}
            para o total da fatura. Confira se o PDF tem todas as páginas. Importando assim, a
            fatura fica marcada &quot;não confere&quot; na página do cartão.
          </p>
          <Link
            href="/lancamentos/importar"
            className={cn(SMALL_BUTTON, "col-span-2 md:col-span-1")}
          >
            Escolher outro arquivo
          </Link>
        </div>
      ) : null}

      <div className="md:bg-card flex flex-col gap-4 md:gap-4 md:rounded-[1.125rem] md:border md:px-[1.375rem] md:py-5">
        <section
          aria-labelledby="conferir"
          className="bg-card flex flex-col gap-3.5 rounded-[1.125rem] border p-3.5 md:gap-4 md:border-0 md:bg-transparent md:p-0"
        >
          <h2 id="conferir" className="text-lg font-extrabold md:text-xl">
            Conferir antes de importar
          </h2>
          {invoice ? (
            <InvoiceSummary
              institution={page.institution}
              lastFour={page.lastFour}
              dueDate={invoice.dueDate}
              fileName={page.fileName}
              rowCount={total}
              profile={page.profile}
            />
          ) : (
            <PreviewSummary
              kind={page.statementKind}
              institution={page.institution}
              lastFour={page.lastFour}
              period={page.period}
              fileName={page.fileName}
              rowCount={total}
              balance={page.balance}
            />
          )}

          <div
            className={cn(
              "flex flex-col gap-3.5",
              invoice && "md:grid md:grid-cols-2 md:items-start md:gap-5",
            )}
          >
            {page.account ? (
              <AccountPicker
                action={`/lancamentos/importar/${page.id}`}
                options={page.accounts}
                current={page.account.id}
                suggestion={page.suggestion}
                lastFour={page.lastFour}
                chosenByYou={page.chosenByYou}
              />
            ) : (
              <Note icon={Info} tone={4}>
                Nenhuma {isCard ? "conta de cartão de crédito" : "conta corrente ou poupança"} numa
                carteira que você edita.{" "}
                <Link href="/ajustes/contas" className={TEXT_LINK}>
                  Cadastre a conta
                </Link>{" "}
                e envie o arquivo de novo.
              </Note>
            )}
            {invoice ? <InvoiceSettlement invoice={invoice} /> : null}
          </div>

          {invoice ? (
            <Note icon={Info}>
              Compra parcelada vem como &quot;4/6&quot;, como na fatura. IOF, juros e multa entram
              na fatura do cartão, não como lançamento. Do número do cartão, só os 4 últimos dígitos
              são lidos.
              {page.skipped > 0
                ? ` ${page.skipped === 1 ? "O pagamento da fatura anterior fica" : `${page.skipped} linhas de pagamento ficam`} de fora: ele já está no extrato da conta.`
                : ""}
            </Note>
          ) : isCard ? (
            <Note icon={Info}>
              Compra parcelada vem como &quot;3/6&quot; e compra em dólar com o valor em reais, como
              na fatura; o IOF vem numa linha própria. O número inteiro do cartão que o arquivo traz
              é descartado.
              {page.skipped > 0
                ? ` ${page.skipped === 1 ? "O pagamento da fatura fica" : `${page.skipped} linhas de pagamento ficam`} de fora: ele já está no extrato da conta.`
                : ""}
            </Note>
          ) : page.skipped > 0 ? (
            <Note icon={Info}>
              {page.skipped === 1
                ? "1 linha de valor zero fica"
                : `${page.skipped} linhas de valor zero ficam`}{" "}
              de fora.
            </Note>
          ) : null}

          <ImportTiles counts={page.counts} format={page.format} />

          {total > 0 ? (
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2.5">
                <h3 className="text-[0.9375rem] font-extrabold md:text-base">
                  {invoice ? "Os lançamentos da fatura" : "Os lançamentos do arquivo"}
                </h3>
                {total > shown ? (
                  <span className="text-muted-foreground hidden text-[0.8125rem] md:inline">
                    {shown} de {total} · os outros aparecem em Recebidos depois
                  </span>
                ) : null}
              </div>
              <PreviewRows rows={page.rows} states={page.states} />
            </div>
          ) : null}
        </section>

        <ImportFooter
          importId={page.id}
          accountId={page.account?.id ?? null}
          count={page.counts.NEW}
          invoice={invoice}
        />
      </div>
    </>
  );
}
