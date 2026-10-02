"use client";

import { useState } from "react";
import { Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

// Lista dos códigos de backup com "Copiar" e "Baixar". Eles são a única forma de entrar se o
// celular com o app autenticador for perdido. Aparecem uma vez só: o banco guarda cifrados.
export function BackupCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  const text = `Códigos de backup do FinTrack (cada um vale uma vez)\n\n${codes.join("\n")}\n`;

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
  }

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "fintrack-codigos-de-backup.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-3">
      <ol
        aria-label="Códigos de backup"
        className="bg-muted tabular grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg p-4 font-mono text-sm"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={copy}>
          <Copy aria-hidden />
          {copied ? "Copiados" : "Copiar"}
        </Button>
        <Button type="button" variant="outline" onClick={download}>
          <Download aria-hidden />
          Baixar .txt
        </Button>
      </div>
      <p role="status" className="sr-only">
        {copied ? "Códigos copiados para a área de transferência." : ""}
      </p>
    </div>
  );
}
