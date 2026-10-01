import type { ExternalToast } from "sonner";

// Os 4 segundos padrão não bastam para chegar ao "Desfazer" pelo teclado ou leitor de tela
export const UNDO_TOAST_DURATION_MS = 10_000;

// Alt+T é o atalho do Sonner: leva o foco aos avisos e pausa o tempo enquanto estiverem abertos
export const UNDO_SHORTCUT_HINT = "Alt+T leva aos avisos e pausa o tempo.";

type UndoToastInput = {
  description?: string;
  onUndo: () => void;
};

// O Sonner guarda o elemento que tinha foco antes do aviso e o devolve quando o foco sai dele.
// Soltar o foco antes de desfazer faz essa devolução acontecer agora, e não por cima do foco
// que o onUndo vai colocar no lugar certo.
function releaseToastFocus(): void {
  if (typeof document === "undefined") return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.closest("[data-sonner-toaster]")) active.blur();
}

// Opções de um aviso com "Desfazer": tempo maior, atalho explicado e foco devolvido ao onUndo
export function undoToastOptions({ description, onUndo }: UndoToastInput): ExternalToast {
  return {
    duration: UNDO_TOAST_DURATION_MS,
    description: description ? `${description}. ${UNDO_SHORTCUT_HINT}` : UNDO_SHORTCUT_HINT,
    action: {
      label: "Desfazer",
      onClick: () => {
        releaseToastFocus();
        onUndo();
      },
    },
  };
}
