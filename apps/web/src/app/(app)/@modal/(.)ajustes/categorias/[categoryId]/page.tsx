import { StepFooter } from "@/components/feedback/step-footer";
import { RouteModal } from "@/components/ui/route-modal";
import { getEditCategoryPage } from "@/features/categories/server/queries";
import { CategoryEditForm } from "@/features/categories/ui/category-edit-form";
import { requireUser } from "@/lib/auth/session";

// Editar categoria em modal (M13.2, prancha M-Categoria), por cima de Categorias.
export default async function EditCategoryModal({
  params,
}: PageProps<"/ajustes/categorias/[categoryId]">) {
  const session = await requireUser();
  const { categoryId } = await params;
  const page = await getEditCategoryPage(session, categoryId);
  if (!page) {
    return (
      <RouteModal title="Editar categoria">
        <p className="text-sm">
          Esta categoria não pode ser editada aqui: ela não existe no seu lar.
        </p>
      </RouteModal>
    );
  }
  return (
    <RouteModal
      title="Editar categoria"
      eyebrow={page.category.name}
      footer={
        <StepFooter
          formId="modal-form-editar-categoria"
          submitLabel="Salvar"
          submitIcon="confirmar"
          backLabel="Cancelar"
          backHref="/ajustes/categorias"
          closesModal
        />
      }
    >
      <CategoryEditForm formId="modal-form-editar-categoria" category={page.category} />
    </RouteModal>
  );
}
