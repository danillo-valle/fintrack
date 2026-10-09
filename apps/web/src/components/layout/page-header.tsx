type Props = {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
};

// Toda página começa com um único <h1>: é por ele que o leitor de tela se orienta.
// Visual Elétrico (M07.2; medidas do M07.3): título grande e firme, sem rótulo em caixa alta em
// cima, e a ação principal da página (Novo lançamento, por exemplo) alinhada embaixo, à direita.
export function PageHeader({ title, description, actions }: Props) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4 md:mb-6">
      <div className="min-w-0">
        <h1 className="text-[1.875rem] font-extrabold tracking-[-0.03em] text-balance md:text-[2.5rem]">
          {title}
        </h1>
        {description ? (
          <p className="text-muted-foreground mt-1 text-sm md:text-[0.9375rem]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
