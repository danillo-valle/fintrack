// "Arquivos importados" (M09.3, pranchas E3-Importar e E3-CelImportar): o nome, a conta, o
// período e o que aconteceu com as linhas. O arquivo em si não existe mais; só este resumo.
import { FileText } from "lucide-react";
import type { FileImportSummary } from "../../server/imports";
import { dayAndTime } from "@/lib/dates";
import { dayMonth } from "../review/parts";

/** "31 entraram · 5 já vinham do Meu Pluggy" ou "0 entraram · arquivo já importado". */
export function importOutcome(
  f: Pick<FileImportSummary, "created" | "pluggy" | "alreadyImported">,
) {
  const parts = [f.created === 1 ? "1 entrou" : `${f.created} entraram`];
  if (f.pluggy > 0)
    parts.push(`${f.pluggy} já ${f.pluggy === 1 ? "vinha" : "vinham"} do Meu Pluggy`);
  if (f.created === 0 && f.pluggy === 0 && f.alreadyImported > 0)
    parts.push("arquivo já importado");
  else if (f.alreadyImported > 0)
    parts.push(`${f.alreadyImported} já ${f.alreadyImported === 1 ? "importado" : "importados"}`);
  return parts.join(" · ");
}

function account(f: FileImportSummary) {
  return f.lastFour && !f.accountName.includes(f.lastFour)
    ? `${f.accountName} final ${f.lastFour}`
    : f.accountName;
}

export function ImportHistory({ history }: { history: readonly FileImportSummary[] }) {
  return (
    <section
      aria-labelledby="historico"
      className="bg-card flex flex-col gap-1.5 rounded-[1.125rem] border p-3.5 md:px-[1.375rem] md:py-[1.125rem]"
    >
      <h2 id="historico" className="text-[1.0625rem] font-extrabold md:text-xl">
        Arquivos importados
      </h2>
      <p className="text-muted-foreground text-[0.8125rem]">
        O arquivo é lido e descartado; fica só a impressão digital, para avisar se ele voltar.
      </p>
      {history.length === 0 ? (
        <p className="text-muted-foreground py-3 text-sm">Nenhum arquivo importado ainda.</p>
      ) : (
        <ul className="divide-y" data-testid="arquivos-importados">
          {history.map((f) => {
            const when = dayAndTime(f.importedAt);
            const period = f.period
              ? `${dayMonth(f.period.from)} a ${dayMonth(f.period.to)}`
              : "sem período";
            return (
              <li
                key={f.id}
                className="grid grid-cols-[2.125rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-3 md:grid-cols-[2.125rem_minmax(0,1fr)_auto]"
              >
                <span
                  aria-hidden
                  className="bg-muted row-span-2 grid size-[2.125rem] place-items-center rounded-[0.625rem]"
                >
                  <FileText className="size-[1.125rem]" />
                </span>
                <strong className="truncate text-[0.9375rem]">{f.fileName}</strong>
                <span className="text-muted-foreground tabular hidden font-mono text-[0.8125rem] md:row-span-2 md:block">
                  {when.day}, {when.time}
                </span>
                <span className="text-muted-foreground text-[0.8125rem]">
                  {account(f)} · {period} · {importOutcome(f)}
                  <span className="md:hidden">
                    {" "}
                    · {when.day}, {when.time}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
