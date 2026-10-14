"use client";

// O formulário do "Confirmar o par" (M09.2): só os dois ids. O botão fica no rodapé do modal (ou
// embaixo, na página inteira) e se liga a ele por form="…". Deu certo: a action volta para a
// revisão com o aviso "Desfazer". Deu errado (já conferido em outra aba, por exemplo): o aviso
// vermelho aparece aqui, em cima da comparação.
import { ActionForm } from "@/components/feedback/action-form";
import { confirmPairAction } from "../../server/review-actions";

export function PairConfirmForm({
  formId,
  receivedId,
  ownId,
}: {
  formId: string;
  receivedId: string;
  ownId: string;
}) {
  return (
    <ActionForm action={confirmPairAction} id={formId} aria-label="Confirmar o par">
      {() => (
        <>
          <input type="hidden" name="receivedId" value={receivedId} />
          <input type="hidden" name="ownId" value={ownId} />
        </>
      )}
    </ActionForm>
  );
}
