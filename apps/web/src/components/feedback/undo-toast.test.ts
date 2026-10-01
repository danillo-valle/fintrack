import { describe, expect, it, vi } from "vitest";
import { UNDO_SHORTCUT_HINT, UNDO_TOAST_DURATION_MS, undoToastOptions } from "./undo-toast";

describe("undoToastOptions", () => {
  it("dura 10 segundos", () => {
    expect(UNDO_TOAST_DURATION_MS).toBe(10_000);
    expect(undoToastOptions({ onUndo: () => {} }).duration).toBe(10_000);
  });

  it("explica o atalho Alt+T", () => {
    expect(undoToastOptions({ onUndo: () => {} }).description).toBe(UNDO_SHORTCUT_HINT);
    expect(UNDO_SHORTCUT_HINT).toContain("Alt+T");
  });

  it("junta o atalho à descrição que já existe", () => {
    const { description } = undoToastOptions({ description: "Mercado", onUndo: () => {} });
    expect(description).toBe(`Mercado. ${UNDO_SHORTCUT_HINT}`);
  });

  it("o botão Desfazer chama onUndo", () => {
    const onUndo = vi.fn();
    const { action } = undoToastOptions({ onUndo });
    // action pode ser um ReactNode qualquer; aqui precisa ser o objeto { label, onClick }
    if (typeof action !== "object" || action === null || !("onClick" in action)) {
      throw new Error("aviso sem ação");
    }

    expect(action.label).toBe("Desfazer");
    action.onClick({} as React.MouseEvent<HTMLButtonElement>);
    expect(onUndo).toHaveBeenCalledOnce();
  });
});
