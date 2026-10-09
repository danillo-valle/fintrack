import { Brand } from "@/components/layout/brand";

type Props = {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

// Moldura das telas de entrada: a marca, um único <h1> e o formulário.
// Fica fora da casca do app (sem menu): quem está aqui ainda não entrou.
export function AuthCard({ title, description, children, footer }: Props) {
  return (
    <div className="flex w-full max-w-sm flex-col gap-6">
      <div className="lg:hidden">
        <Brand />
      </div>
      <div className="bg-card rounded-3xl border p-6 shadow-[0_18px_40px_-24px_rgb(14_19_37/0.35)] md:p-8">
        <h1 className="text-2xl font-bold tracking-tight text-balance">{title}</h1>
        {description ? (
          <div className="text-muted-foreground mt-1 mb-6 text-sm">{description}</div>
        ) : (
          <div className="mb-6" />
        )}
        {children}
      </div>
      {footer ? <div className="text-muted-foreground text-center text-sm">{footer}</div> : null}
    </div>
  );
}
