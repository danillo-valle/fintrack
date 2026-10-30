"use client";

// Um painel que abre por um botão e fecha sozinho (M13.1): o menu "⋯" das linhas e o menu de quem
// está na sessão. Esc fecha e devolve o foco ao botão; clique fora fecha; `dismiss` fecha sem mexer
// no foco (um link do painel que leva para outra tela). Quem usa liga `rootRef` no contêiner
// (botão + painel), `triggerRef` no botão e `panelId` no aria-controls.
import { useCallback, useEffect, useId, useRef, useState } from "react";

export function usePopover() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  /** Esc: fecha e devolve o foco ao botão. */
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return {
    open,
    toggle: () => setOpen((v) => !v),
    /** Fecha sem mexer no foco (um link dentro do painel leva para outra tela) */
    dismiss: () => setOpen(false),
    panelId,
    rootRef,
    triggerRef,
  };
}
