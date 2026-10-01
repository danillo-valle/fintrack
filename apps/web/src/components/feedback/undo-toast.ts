import { toast } from "sonner";

// Tempo do aviso com "Desfazer". O padrão do Sonner (4 s) é curto para quem chega ao botão
// pelo teclado ou lê com leitor de tela. 10 s mais o atalho Alt+T, que leva o foco aos avisos
// e pausa o tempo, atendem ao critério 2.2.1 (tempo ajustável) da WCAG 2.2.
export const UNDO_TOAST_DURATION = 10_000;
export const UNDO_TOAST_HINT = "Alt+T leva aos avisos e pausa o tempo.";

type UndoToastOptions = {
  description?: string;
  variant?: "default" | "success";
  onUndo: () => void;
};

// Aviso padrão do FinTrack para ações que podem ser desfeitas (excluir, salvar, mover)
export function undoToast(
  message: string,
  { description, variant = "default", onUndo }: UndoToastOptions,
) {
  const show = variant === "success" ? toast.success : toast;
  return show(message, {
    description: description ? `${description} ${UNDO_TOAST_HINT}` : UNDO_TOAST_HINT,
    duration: UNDO_TOAST_DURATION,
    action: { label: "Desfazer", onClick: onUndo },
  });
}
