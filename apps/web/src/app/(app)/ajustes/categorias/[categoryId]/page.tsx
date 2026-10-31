import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StepFooter } from "@/components/feedback/step-footer";
import { PageHeader } from "@/components/layout/page-header";
import { getEditCategoryPage } from "@/features/categories/server/queries";
import { CategoryEditForm } from "@/features/categories/ui/category-edit-form";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Editar categoria" };

// Editar categoria na página inteira (M13.2; recarregar, abrir o link direto ou o "Abrir em
// Categorias" do seletor). Pelo menu "⋯" de Categorias, abre em modal (prancha M-Categoria).
export default async function EditCategoryPage({
  params,
}: PageProps<"/ajustes/categorias/[categoryId]">) {
  const session = await requireUser();
  const { categoryId } = await params;
  const page = await getEditCategoryPage(session, categoryId);
  if (!page) notFound();
  return (
    <>
      <PageHeader
        help="categorias-e-regras"
        crumb={{ href: "/ajustes/categorias", label: "Categorias e regras" }}
        title="Editar categoria"
        description={page.category.name}
      />
      <div className="bg-card flex max-w-2xl flex-col gap-5 rounded-[1.25rem] border p-4 md:p-6">
        <CategoryEditForm formId="form-editar-categoria" category={page.category} />
        <StepFooter
          formId="form-editar-categoria"
          submitLabel="Salvar"
          submitIcon="confirmar"
          backLabel="Cancelar"
          backHref="/ajustes/categorias"
        />
      </div>
    </>
  );
}
