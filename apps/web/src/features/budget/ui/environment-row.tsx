import type { Environment } from "@/features/transactions/environments";
import { EnvironmentSwitcher } from "@/features/transactions/ui/environment-switcher";

// O seletor de ambiente das telas do M08 (canvas D): numa linha própria, logo abaixo do título,
// com a frase "Somando os ambientes … O ambiente pessoal de … não entra aqui." ao lado. Com um
// ambiente só, não há seletor nem frase.
export function EnvironmentRow({
  environments,
  current,
  sentence,
  hrefFor,
  children,
}: {
  environments: readonly Environment[];
  current: string | null;
  sentence: string | null;
  hrefFor: (walletId: string | null) => string;
  /** O que fica à direita na mesma linha (as ações do orçamento, o período da evolução) */
  children?: React.ReactNode;
}) {
  if (environments.length < 2 && !children) return null;
  return (
    <div className="flex flex-col gap-2.5 md:flex-row md:flex-wrap md:items-center md:gap-3.5">
      <EnvironmentSwitcher environments={environments} current={current} hrefFor={hrefFor} />
      {sentence ? (
        <p className="text-muted-foreground text-[0.8125rem] md:text-sm">{sentence}</p>
      ) : null}
      {children ? (
        <div className="flex flex-wrap items-center gap-3 md:ml-auto">{children}</div>
      ) : null}
    </div>
  );
}
