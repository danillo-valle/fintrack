import { Brand } from "@/components/layout/brand";
import { ContentReady } from "@/components/layout/content-ready";

type Props = {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

// Moldura das telas de entrada: a marca, um único <h1> e o formulário.
// Fica fora da casca do app (sem menu): quem está aqui ainda não entrou.
//
// ContentReady (M10.0), o mesmo do PageHeader: as telas de entrada leem cookies e parâmetros, então
// o conteúdo hidrata depois da moldura (o data-hydrated marca só a moldura). No N150, com a suíte
// inteira, o teste clicava em "Confirmar" do 2FA com o formulário ainda sem o React. Com a marca, o
// openPage e o waitForContent esperam o formulário ligado, como nas telas do app.
export function AuthCard({ title, description, children, footer }: Props) {
  return (
    <div className="flex w-full max-w-sm flex-col gap-6">
      <ContentReady />
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
