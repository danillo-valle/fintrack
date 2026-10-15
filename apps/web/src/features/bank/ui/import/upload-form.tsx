"use client";

// Passo 1 · o arquivo (M09.3, pranchas E3-Importar e E3-CelImportar). O campo de arquivo de
// verdade fica por baixo do botão "Escolher arquivo" (um <label>): escolher já envia.
//
// Antes do React carregar: o formulário é um POST comum (a Server Action vai direta para o
// useActionState, regra do projeto). Se a pessoa escolheu o arquivo antes da hidratação, o
// envio acontece assim que o React assume; sem JavaScript, o botão "Enviar arquivo" aparece.
import { useEffect, useRef, useState } from "react";
import { FileText, Upload } from "lucide-react";
import { ActionForm } from "@/components/feedback/action-form";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { previewFileAction } from "../../server/import-actions";

const ACCEPT = ".ofx,.qfx,application/x-ofx,application/ofx";

export function UploadForm() {
  return (
    <ActionForm action={previewFileAction} aria-label="Enviar extrato" className="contents">
      {({ pending }) => <Dropzone pending={pending} />}
    </ActionForm>
  );
}

function Dropzone({ pending }: { pending: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const submit = () => input.current?.form?.requestSubmit();

  // Arquivo escolhido antes da hidratação: envia agora
  useEffect(() => {
    if (input.current?.files?.length) submit();
  }, []);

  return (
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
        Escolha o arquivo .ofx do banco
      </label>
      <span className="text-muted-foreground text-sm">
        <span className="md:hidden">ou toque para escolher</span>
        <span className="hidden md:inline">ou arraste para cá</span>
      </span>
      <input
        ref={input}
        id="arquivo"
        name="arquivo"
        type="file"
        accept={ACCEPT}
        aria-describedby="arquivo-ajuda"
        required
        disabled={pending}
        onChange={() => submit()}
        className="peer sr-only"
      />
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
        <button type="submit" className={cn(buttonVariants(), "h-10 rounded-xl px-4 font-bold")}>
          Enviar arquivo
        </button>
      </noscript>
      <span id="arquivo-ajuda" className="text-muted-foreground text-[0.8125rem]">
        Até 2 MB · extrato da conta ou fatura do cartão
      </span>
    </div>
  );
}
