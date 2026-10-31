import type { Metadata } from "next";
import Link from "next/link";
import { Archive, ArchiveRestore, Check, PencilLine, Tags } from "lucide-react";
import { ActionButton } from "@/components/feedback/action-button";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { ActionsMenu, MENU_ITEM } from "@/components/visual/actions-menu";
import { deleteRuleAction, setCategoryArchivedAction } from "@/features/categories/server/actions";
import { getCategoriesPage } from "@/features/categories/server/queries";
import { CategoryForm, RuleForm } from "@/features/categories/ui/category-forms";
import { requireUser } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Categorias e regras" };

const SECTION = "bg-card rounded-2xl border p-5 md:p-6";
const MATCH = { CONTAINS: "contém", STARTS_WITH: "começa com", EQUALS: "é igual a" } as const;

// Categorias e regras do lar (M07). As regras são a primeira camada da cascata de sugestão:
// "se a descrição contém X, a categoria é Y". Regras também nascem de uma correção no
// lançamento ("sempre categorizar assim"). M13.2: cada categoria tem o menu "⋯" com Editar (nome e
// tipo) e Arquivar; depois de editar, o aviso no topo.
export default async function CategoriesPage({ searchParams }: PageProps<"/ajustes/categorias">) {
  const session = await requireUser();
  const page = await getCategoriesPage(session);
  const editedId = (await searchParams).editada;
  if (!page) {
    return (
      <>
        <PageHeader help="categorias-e-regras" title="Categorias e regras" />
        <EmptyState
          icon={Tags}
          title="Você ainda não tem um lar"
          description="Crie o seu lar em Carteiras primeiro."
        />
      </>
    );
  }
  const active = page.categories.filter((c) => !c.archived);
  const edited =
    typeof editedId === "string" ? (page.categories.find((c) => c.id === editedId) ?? null) : null;

  return (
    <>
      <PageHeader
        help="categorias-e-regras"
        title="Categorias e regras"
        description="Do lar inteiro: as duas pessoas organizam"
      />
      <div className="flex max-w-2xl flex-col gap-6">
        {edited ? (
          <p
            role="status"
            data-testid="aviso-criado"
            className="bg-income/12 flex items-center gap-3 rounded-2xl p-3.5 text-[0.9375rem]"
          >
            <Check aria-hidden className="text-income size-5 shrink-0" />
            <strong className="break-words">Categoria “{edited.name}” atualizada.</strong>
          </p>
        ) : null}
        <section aria-labelledby="categorias" className={SECTION}>
          <h2 id="categorias" className="mb-3 font-semibold">
            Categorias
          </h2>
          {page.categories.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhuma categoria ainda.</p>
          ) : (
            <ul className="divide-y">
              {page.categories.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span className="break-words">
                    {c.parentName ? `${c.parentName} › ` : ""}
                    {c.name}
                    <span className="text-muted-foreground text-sm">
                      {" "}
                      · {c.kind === "EXPENSE" ? "despesa" : "receita"} · {c.transactionCount}{" "}
                      {c.transactionCount === 1 ? "lançamento" : "lançamentos"}
                      {c.archived ? " · arquivada" : ""}
                    </span>
                  </span>
                  {page.canManage ? (
                    <ActionsMenu label={`Opções da categoria ${c.name}`}>
                      <Link
                        href={`/ajustes/categorias/${c.id}`}
                        scroll={false}
                        aria-label={`Editar a categoria ${c.name}`}
                        className={MENU_ITEM}
                      >
                        <PencilLine aria-hidden />
                        Editar
                      </Link>
                      <ActionButton
                        action={setCategoryArchivedAction}
                        fields={{ categoryId: c.id, archived: c.archived ? "false" : "true" }}
                        label={`${c.archived ? "Restaurar" : "Arquivar"} ${c.name}`}
                        variant="ghost"
                        className={cn(
                          MENU_ITEM,
                          !c.archived && "text-destructive hover:text-destructive",
                        )}
                      >
                        {c.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                        {c.archived ? "Restaurar" : "Arquivar"}
                      </ActionButton>
                    </ActionsMenu>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {page.canManage ? (
          <section aria-labelledby="nova-categoria" className={SECTION}>
            <h2 id="nova-categoria" className="mb-3 font-semibold">
              Nova categoria
            </h2>
            <CategoryForm parents={active.filter((c) => !c.parentId)} />
          </section>
        ) : null}

        <section aria-labelledby="regras" className={SECTION}>
          <h2 id="regras" className="mb-1 font-semibold">
            Regras
          </h2>
          <p className="text-muted-foreground mb-3 text-sm">
            Quando duas regras combinam, vale a mais específica (o texto mais longo).
          </p>
          {page.rules.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhuma regra ainda.</p>
          ) : (
            <ul className="divide-y">
              {page.rules.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span className="break-words">
                    {MATCH[r.match]} “{r.pattern}” → {r.category.name}
                    {r.category.archivedAt ? " (categoria arquivada)" : ""}
                  </span>
                  {page.canManage ? (
                    <ActionButton
                      action={deleteRuleAction}
                      fields={{ ruleId: r.id }}
                      label={`Apagar a regra ${r.pattern}`}
                      confirm="Apagar esta regra?"
                      confirmLabel="Sim, apagar"
                      variant="ghost"
                    >
                      Apagar
                    </ActionButton>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {page.canManage && active.length > 0 ? (
          <section aria-labelledby="nova-regra" className={SECTION}>
            <h2 id="nova-regra" className="mb-3 font-semibold">
              Nova regra
            </h2>
            <RuleForm categories={active} />
          </section>
        ) : null}
      </div>
    </>
  );
}
