import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Inbox } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { ListSkeleton } from "@/components/feedback/list-skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { AmountText } from "@/components/money/amount-text";
import { Button } from "@/components/ui/button";
import { formatDateLong } from "@/lib/dates";
import { ErrorDemo, MoneyInputDemo, UndoDeleteDemo } from "./demos";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Catálogo de componentes",
  robots: { index: false },
};

const COLORS = [
  ["background", "bg-background"],
  ["foreground", "bg-foreground"],
  ["primary", "bg-primary"],
  ["muted", "bg-muted"],
  ["income (receita)", "bg-income"],
  ["expense (despesa)", "bg-expense"],
  ["warning (alerta)", "bg-warning"],
  ["border", "bg-border"],
] as const;

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="border-t py-8 first-of-type:border-t-0 first-of-type:pt-0"
    >
      <h2 id={id} className="mb-4 text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

// Vitrine de todos os componentes do FinTrack. Só existe em desenvolvimento.
export default async function UiCatalogPage() {
  if (process.env.NODE_ENV === "production") notFound();
  await requireUser(); // toda página do app começa conferindo a sessão (skill auth-guard)

  return (
    <>
      <PageHeader
        title="Catálogo de componentes"
        description="Tudo o que o app usa, em um lugar. Teste com o teclado e nos dois temas."
      />

      <Section id="cores" title="Cores">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {COLORS.map(([name, cls]) => (
            <li key={name} className="flex items-center gap-2 text-sm">
              <span aria-hidden className={`${cls} size-8 shrink-0 rounded-md border`} />
              {name}
            </li>
          ))}
        </ul>
      </Section>

      <Section id="botoes" title="Botões">
        <div className="flex flex-wrap gap-2">
          <Button>Principal</Button>
          <Button variant="secondary">Secundário</Button>
          <Button variant="outline">Contorno</Button>
          <Button variant="ghost">Discreto</Button>
          <Button variant="destructive">Excluir</Button>
          <Button disabled>Desabilitado</Button>
        </div>
      </Section>

      <Section id="valores" title="Valores">
        <ul className="flex flex-col gap-2">
          <li>
            <AmountText cents={123456n} />
          </li>
          <li>
            <AmountText cents={-8990n} />
          </li>
          <li>
            <AmountText cents={0n} />
          </li>
        </ul>
        <p className="text-muted-foreground mt-3 text-sm">
          Data de exemplo: {formatDateLong(new Date("2026-10-15T15:00:00Z"))}
        </p>
      </Section>

      <Section id="campo-valor" title="Campo de valor">
        <MoneyInputDemo />
      </Section>

      <Section id="vazio" title="Estado vazio">
        <EmptyState
          icon={Inbox}
          title="Nada por aqui"
          description="Todo estado vazio explica o que falta e oferece a ação que resolve."
          action={<Button>Criar o primeiro</Button>}
        />
      </Section>

      <Section id="carregando" title="Carregando">
        <ListSkeleton rows={3} />
      </Section>

      <Section id="erro" title="Erro">
        <ErrorDemo />
      </Section>

      <Section id="desfazer" title="Excluir com desfazer">
        <UndoDeleteDemo />
      </Section>
    </>
  );
}
