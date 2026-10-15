"use client";

// Passo 1 · o arquivo (M09.3, pranchas E3-Importar e E3-CelImportar; M09.4, E4-Importar,
// E4-Senha e E4-CelSenha). O campo de arquivo de verdade fica por baixo do botão "Escolher
// arquivo" (um <label>): escolher já envia. OFX ou PDF da fatura: quem decide é o servidor,
// pelos primeiros bytes.
//
// Antes do React carregar: o formulário é um POST comum (a Server Action vai direta para o
// useActionState, regra do projeto). Se a pessoa escolheu o arquivo antes da hidratação, o
// envio acontece assim que o React assume; sem JavaScript, o botão "Enviar arquivo" aparece.
//
// PDF com senha: o servidor devolve o passo "Este PDF tem senha" e o arquivo NÃO fica lá. Ele
// fica aqui, na memória da aba (o `kept`), e volta para o campo (DataTransfer) para seguir junto
// com a senha. A senha nunca é guardada: nem no navegador (autocomplete off), nem no servidor.
// Sem o arquivo na aba (envio antes do React), o passo mostra o campo para escolher de novo.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileText, Lock, Upload } from "lucide-react";
import { ActionForm } from "@/components/feedback/action-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Note } from "@/components/visual/note";
import { PasswordInput } from "@/features/auth/ui/password-input";
import { cn } from "@/lib/utils";
import { INITIAL_UPLOAD_STATE, type UploadState } from "../../import-state";
import { previewFileAction } from "../../server/import-actions";
import { PdfFileIcon } from "./pdf-file-icon";

const ACCEPT = ".ofx,.qfx,.pdf,application/x-ofx,application/ofx,application/pdf";

/**
 * O envio e o que fica em volta dele na tela: `tip` (a nota "Como exportar", dentro do cartão do
 * arquivo), `aside` (as notas à direita) e `below` (o histórico). No passo da senha, só o cartão
 * da senha aparece (prancha E4-Senha).
 */
export function UploadForm({
  tip,
  aside,
  below,
}: {
  tip: ReactNode;
  aside: ReactNode;
  below: ReactNode;
}) {
  return (
    <ActionForm
      action={previewFileAction}
      initialState={INITIAL_UPLOAD_STATE}
      aria-label="Enviar extrato"
      className="flex flex-col gap-4 md:gap-5"
    >
      {({ pending, state }) => (
        <UploadBody pending={pending} state={state} tip={tip} aside={aside} below={below} />
      )}
    </ActionForm>
  );
}

function UploadBody({
  pending,
  state,
  tip,
  aside,
  below,
}: {
  pending: boolean;
  state: UploadState;
  tip: ReactNode;
  aside: ReactNode;
  below: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  // O arquivo escolhido, guardado na aba para o passo da senha
  const kept = useRef<File | null>(null);
  const [refilled, setRefilled] = useState(false);
  const [dragging, setDragging] = useState(false);
  const submit = () => input.current?.form?.requestSubmit();
  const keep = (files: FileList | null) => {
    kept.current = files?.[0] ?? null;
  };

  // Arquivo escolhido antes da hidratação: envia agora
  useEffect(() => {
    if (input.current?.files?.length && !state.pdf) {
      keep(input.current.files);
      submit();
    }
    // Só na primeira vez: depois, cada escolha envia pelo onChange
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Passo da senha: o React limpou o formulário depois do envio; o arquivo volta para o campo
  const asking = state.pdf;
  useEffect(() => {
    const file = kept.current;
    if (!asking || !input.current || !file || file.name.slice(0, 120) !== asking.fileName) {
      setRefilled(false);
      return;
    }
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.current.files = transfer.files;
    setRefilled(true);
  }, [asking]);

  const fileInput = (
    <input
      ref={input}
      id="arquivo"
      name="arquivo"
      type="file"
      accept={asking ? ".pdf,application/pdf" : ACCEPT}
      // No passo da senha com o arquivo de volta, o campo some (o cartão já mostra o nome)
      aria-describedby={asking && refilled ? undefined : "arquivo-ajuda"}
      aria-hidden={asking && refilled ? true : undefined}
      tabIndex={asking && refilled ? -1 : undefined}
      required
      disabled={pending}
      onChange={(event) => {
        keep(event.currentTarget.files);
        if (!asking) submit();
      }}
      className={cn("peer", asking && !refilled ? "w-full text-sm" : "sr-only")}
    />
  );

  if (asking) {
    return (
      <PasswordStep
        fileName={asking.fileName}
        size={asking.size}
        pending={pending}
        fileInput={fileInput}
        refilled={refilled}
        onCancel={() => {
          // Cancelar não manda o arquivo de novo
          if (input.current) input.current.value = "";
          kept.current = null;
        }}
      />
    );
  }

  return (
    <>
      <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:gap-5">
        <section
          aria-label="Arquivo"
          className="bg-card flex flex-col gap-3 rounded-[1.125rem] border p-3.5 md:gap-3.5 md:p-[1.125rem]"
        >
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (!input.current || event.dataTransfer.files.length === 0) return;
              input.current.files = event.dataTransfer.files;
              keep(event.dataTransfer.files);
              submit();
            }}
            className={cn(
              "border-chart-1-ink relative flex flex-col items-center gap-2.5 rounded-[1.125rem] border-[1.5px] border-dashed bg-[color-mix(in_srgb,var(--chart-1)_14%,transparent)] px-4 py-[1.375rem] text-center md:px-6 md:py-[2.125rem]",
              dragging && "ring-ring ring-3",
            )}
          >
            <span
              aria-hidden
              className="bg-card text-chart-1-ink grid size-12 place-items-center rounded-[0.875rem]"
            >
              <Upload className="size-6" />
            </span>
            <label htmlFor="arquivo" className="text-[1.0625rem] font-extrabold">
              Escolha o extrato .ofx ou a fatura .pdf
            </label>
            <span className="text-muted-foreground text-sm">
              <span className="md:hidden">ou toque para escolher</span>
              <span className="hidden md:inline">ou arraste para cá</span>
            </span>
            {fileInput}
            {/* O botão é o rótulo do campo: clicar abre o seletor; o foco do campo aparece nele */}
            <label
              htmlFor="arquivo"
              aria-hidden
              className={cn(
                buttonVariants({ variant: "outline" }),
                "peer-focus-visible:ring-ring h-11 cursor-pointer gap-2 rounded-xl px-[1.125rem] text-sm font-bold peer-focus-visible:ring-3 md:h-10",
                pending && "pointer-events-none opacity-60",
              )}
            >
              <FileText aria-hidden className="size-[1.125rem]" />
              {pending ? "Lendo o arquivo…" : "Escolher arquivo"}
            </label>
            <noscript>
              <button
                type="submit"
                className={cn(buttonVariants(), "h-10 rounded-xl px-4 font-bold")}
              >
                Enviar arquivo
              </button>
            </noscript>
            <span id="arquivo-ajuda" className="text-muted-foreground text-[0.8125rem]">
              OFX até 2 MB · PDF da fatura até 5 MB
            </span>
          </div>
          {tip}
        </section>
        {aside}
      </div>
      {below}
    </>
  );
}

const sizeText = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** "Este PDF tem senha" (pranchas E4-Senha e E4-CelSenha). */
function PasswordStep({
  fileName,
  size,
  pending,
  fileInput,
  refilled,
  onCancel,
}: {
  fileName: string;
  size: number;
  pending: boolean;
  fileInput: ReactNode;
  refilled: boolean;
  onCancel: () => void;
}) {
  const buttons = (
    <>
      <Button
        type="submit"
        name="acao"
        value="cancelar"
        variant="outline"
        disabled={pending}
        onClick={onCancel}
        className="h-11 w-full rounded-xl px-4 text-sm font-bold md:w-auto"
      >
        Cancelar
      </Button>
      <Button
        type="submit"
        disabled={pending}
        className="h-11 w-full gap-2 rounded-xl px-[1.125rem] text-sm font-bold md:w-auto"
      >
        <Lock aria-hidden className="size-[1.125rem]" />
        {pending ? "Abrindo…" : "Abrir e conferir"}
      </Button>
    </>
  );
  return (
    <>
      <section
        aria-labelledby="senha-titulo"
        data-testid="passo-senha"
        className="bg-card flex flex-col gap-4 rounded-[1.125rem] border p-3.5 md:px-[1.375rem] md:py-5"
      >
        <h2 id="senha-titulo" className="text-lg font-extrabold md:text-xl">
          Este PDF tem senha
        </h2>
        <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3">
          <PdfFileIcon tone={1} />
          <span className="flex min-w-0 flex-col gap-0.5">
            <strong className="truncate text-base">{fileName}</strong>
            <span className="text-muted-foreground text-[0.8125rem]">
              PDF da fatura · {sizeText(size)} · protegido por senha
            </span>
          </span>
        </div>
        <div className="flex max-w-[28.75rem] flex-col gap-3.5">
          {/* Sem o arquivo na aba (o envio aconteceu antes do React): escolher de novo. O campo
              fica sempre no mesmo lugar (trocar de lugar o recriaria, sem o arquivo) */}
          <div className={cn("flex flex-col gap-1.5", refilled && "contents")}>
            {refilled ? null : (
              <label htmlFor="arquivo" className="text-sm font-semibold">
                Escolha o mesmo PDF de novo
              </label>
            )}
            {fileInput}
            {refilled ? null : (
              <span id="arquivo-ajuda" className="text-muted-foreground text-[0.8125rem]">
                O arquivo não fica guardado: ele volta junto com a senha.
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="senha" className="text-sm font-semibold">
              Senha do PDF
            </label>
            <PasswordInput
              id="senha"
              name="senha"
              autoComplete="off"
              spellCheck={false}
              aria-describedby="senha-ajuda"
              disabled={pending}
              autoFocus
              className="h-11 rounded-xl"
            />
            <span id="senha-ajuda" className="text-muted-foreground text-[0.8125rem]">
              Costuma ser parte do CPF do titular; o banco diz qual no e-mail da fatura.
            </span>
          </div>
        </div>
        <Note icon={Lock} tone={5}>
          A senha só abre o arquivo agora, na memória do servidor, e é descartada junto com ele. O
          FinTrack não grava a senha, nem o arquivo.
        </Note>
        <div className="hidden justify-end gap-2.5 border-t pt-3 md:flex">{buttons}</div>
      </section>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-2.5 md:hidden">
        {buttons}
      </div>
    </>
  );
}
