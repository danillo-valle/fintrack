"use client";

// Botão "Copiar" de um texto que está à vista (M11: o código de vínculo e o número do bot). Copiou:
// o ícone vira o visto e o leitor de tela ouve "Copiado". Sem permissão de área de transferência
// (http, navegador antigo), seleciona o texto na tela para a pessoa copiar à mão.
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CopyButton({
  text,
  targetId,
  label,
  variant = "outline",
}: {
  text: string;
  /** O id do elemento que mostra o texto (selecionado quando a cópia falha) */
  targetId: string;
  /** Nome acessível ("Copiar o código") */
  label: string;
  variant?: "default" | "outline";
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      const target = document.getElementById(targetId);
      if (target) {
        const range = document.createRange();
        range.selectNodeContents(target);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        onClick={copy}
        aria-label={label}
        className="h-10 px-3.5"
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied ? "Copiado" : "Copiar"}
      </Button>
      <span role="status" className="sr-only">
        {copied ? "Copiado" : ""}
      </span>
    </>
  );
}
