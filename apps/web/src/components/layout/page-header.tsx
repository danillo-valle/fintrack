type Props = {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
};

// Toda página começa com um único <h1>: é por ele que o leitor de tela se orienta.
// Visual Elétrico (M07.2): título grande e firme, sem rótulo em caixa alta em cima.
export function PageHeader({ title, description, actions }: Props) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 md:mb-8">
      <div className="min-w-0">
        <h1 className="text-3xl font-bold tracking-tight text-balance md:text-4xl">{title}</h1>
        {description ? (
          <p className="text-muted-foreground mt-1.5 text-sm md:text-base">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
