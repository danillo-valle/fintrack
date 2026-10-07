"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Mostra o link do convite (que só existe nesta resposta) com um botão de copiar.
// O texto "Link copiado" é anunciado pelo leitor de tela (role="status").
export function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Sem permissão de área de transferência (http, navegador antigo): seleciona o texto
      document.getElementById("invite-link")?.focus();
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <label htmlFor="invite-link" className="text-sm font-medium">
        Link do convite (mostrado só agora)
      </label>
      <div className="flex gap-2">
        <Input
          id="invite-link"
          readOnly
          value={link}
          onFocus={(event) => event.currentTarget.select()}
          className="font-mono text-xs"
        />
        <Button type="button" variant="outline" onClick={copy}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          Copiar
        </Button>
      </div>
      <p role="status" className="text-muted-foreground text-xs">
        {copied
          ? "Link copiado."
          : "Envie pelo WhatsApp, por exemplo. Vale por 72 horas e uma única vez."}
      </p>
    </div>
  );
}
