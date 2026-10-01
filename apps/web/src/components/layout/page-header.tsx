type Props = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
};

// Todo página começa com um único <h1>: é por ele que o leitor de tela se orienta
export function PageHeader({ title, description, actions }: Props) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {description ? <p className="text-muted-foreground mt-1 text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  );
}
