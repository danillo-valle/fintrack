"use client";

// O formulário do "Confirmar" no "Por que essa categoria?" (M10.1): o recebido e o ambiente.
// O botão fica no rodapé do modal (form="…"). Deu certo: volta para a revisão com o aviso e o
// "Desfazer". Deu errado (já conferido em outra aba): o aviso vermelho aparece aqui.
import { ActionForm } from "@/components/feedback/action-form";
import { confirmExplainedAction } from "../../server/review-actions";

export function ExplanationConfirmForm({
  formId,
  transactionId,
  walletId,
}: {
  formId: string;
  transactionId: string;
  walletId: string;
}) {
  return (
    <ActionForm action={confirmExplainedAction} id={formId} aria-label="Confirmar o recebido">
      {() => (
        <>
          <input type="hidden" name="transactionId" value={transactionId} />
          <input type="hidden" name="walletId" value={walletId} />
        </>
      )}
    </ActionForm>
  );
}
