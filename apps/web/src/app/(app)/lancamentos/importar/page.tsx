import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, EyeOff, Info, Lock } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Note } from "@/components/visual/note";
import { getImportPage } from "@/features/bank/server/imports";
import { ImportHistory, importOutcome } from "@/features/bank/ui/import/import-history";
import { UploadForm } from "@/features/bank/ui/import/upload-form";
import { requireUser } from "@/lib/auth/session";
import { TEXT_LINK } from "@/lib/styles";

export const metadata: Metadata = { title: "Importar extrato" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// Importar extrato, passo 1 (M09.3, pranchas E3-Importar e E3-CelImportar; M09.4, E4-Importar e
// E4-Senha): o extrato .ofx ou a fatura .pdf, e o histórico. O arquivo é lido e descartado; a
// conferência (passo 2) fica em /importar/[id]. O PDF com senha pede a senha aqui mesmo.
export default async function ImportPage({ searchParams }: PageProps<"/lancamentos/importar">) {
  const session = await requireUser(); // toda página do app começa conferindo a sessão
  const imported = one((await searchParams).importado) ?? null;
  const page = await getImportPage(session, imported);
  const result = page.result;

  return (
    <>
      <PageHeader
        crumb={{
          href: "/lancamentos/recebidos",
          label: "Recebidos do banco",
          trail: "Lançamentos",
        }}
        title="Importar extrato"
        description={
          <>
            <span className="md:hidden">Entra como Recebido, fora das somas.</span>
            <span className="hidden md:inline">
              OFX do banco ou PDF da fatura: entra como Recebido, fora das somas até a revisão.
            </span>
          </>
        }
      />

      {result ? (
        <div
          role="status"
          data-testid="resultado-importacao"
          className="border-income/40 mb-4 grid grid-cols-[1.375rem_minmax(0,1fr)] gap-2.5 rounded-2xl border px-4 py-3.5 text-sm md:mb-5"
        >
          <CircleCheck aria-hidden className="text-income size-5" />
          <p>
            <strong>{result.fileName}</strong> importado: {importOutcome(result)}.{" "}
            {result.created > 0 ? (
              <Link href="/lancamentos/recebidos" className={TEXT_LINK}>
                Revisar os recebidos
              </Link>
            ) : null}
          </p>
        </div>
      ) : null}

      {page.canImport ? (
        <UploadForm
          tip={
            <Note icon={Info}>
              <span className="md:hidden">
                No app do banco: Extrato › Exportar › OFX, ou Fatura › Baixar PDF.
              </span>
              <span className="hidden md:inline">
                <strong>Como exportar:</strong> no app ou no site do banco, Extrato › Exportar ›
                OFX; ou Fatura › Baixar PDF. O PDF traz o vencimento, o total e os encargos, e a
                fatura é conferida ao centavo.
              </span>
            </Note>
          }
          aside={
            <div className="flex flex-col gap-3.5">
              <Note icon={Lock} tone={5} className="bg-card">
                <span className="md:hidden">
                  Só os 4 últimos dígitos da conta e do cartão são lidos.
                </span>
                <span className="hidden md:inline">
                  O FinTrack lê só os <strong>4 últimos dígitos</strong> da conta e do cartão que o
                  arquivo traz. O resto do número não é gravado.
                </span>
              </Note>
              <Note icon={EyeOff} className="bg-card">
                PDF com senha? A tela pede a senha só para abrir o arquivo agora. Ela não é gravada
                nem fica no navegador.
              </Note>
            </div>
          }
          below={<ImportHistory history={page.history} />}
        />
      ) : (
        <EmptyState
          icon={Lock}
          title="Sem conta para importar"
          description="O extrato entra numa conta de uma carteira que você edita. Peça acesso a quem é dono."
        />
      )}
    </>
  );
}
