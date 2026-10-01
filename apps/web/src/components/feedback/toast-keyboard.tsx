"use client";

import { useEffect } from "react";

const TOASTER = "[data-sonner-toaster]";
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

// Lista o que o Tab alcança, na ordem da página
function tabbables(root: ParentNode = document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (el.tabIndex < 0 || el.getClientRects().length === 0 || el.closest("[inert]")) return false;
    // Num grupo de rádios, o Tab só para no marcado
    if (el instanceof HTMLInputElement && el.type === "radio" && !el.checked) {
      return !document.querySelector(`input[type="radio"][name="${el.name}"]:checked`);
    }
    return true;
  });
}

function focusVisibly(el: HTMLElement) {
  el.focus({ preventScroll: true });
  // O Sonner também tenta devolver o foco ao sair do aviso; focar de novo garante o destino
  if (document.activeElement !== el) el.focus({ preventScroll: true });
  // Espera a pilha de avisos recolher e rola o mínimo, respeitando o scroll-padding
  requestAnimationFrame(() => requestAnimationFrame(() => el.scrollIntoView({ block: "nearest" })));
}

// Completa o teclado dos avisos (Sonner). Sem isto, ao sair do aviso com Tab:
// 1. o Sonner devolve o foco ao elemento de antes sem o anel de foco (WCAG 2.4.7);
// 2. o Tab seguinte entra de novo no aviso, e o foco fica girando entre os dois;
// 3. a pilha aberta pelo Alt+T continua aberta e cobre o elemento focado (WCAG 2.4.11).
// Aqui, ao sair do aviso, a pilha recolhe, o foco volta com anel para onde estava, e o
// próximo Tab segue a página pulando o aviso. Para voltar ao aviso: Alt+T.
export function ToastKeyboard() {
  useEffect(() => {
    let origin: HTMLElement | null = null; // onde estava o foco antes de entrar no aviso
    let returned: HTMLElement | null = null; // para onde o foco voltou ao sair do aviso

    function onFocusIn(event: FocusEvent) {
      const target = event.target as HTMLElement;
      const from = event.relatedTarget as HTMLElement | null;
      if (target.closest(TOASTER)) {
        if (from && !from.closest(TOASTER)) origin = from;
      } else if (target !== returned) {
        returned = null;
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
      const active = document.activeElement as HTMLElement | null;
      const toaster = active?.closest<HTMLElement>(TOASTER);

      if (active && toaster) {
        const inside = tabbables(toaster);
        const leaving = event.shiftKey ? active === inside[0] : active === inside.at(-1);
        if (!leaving) return;
        event.preventDefault();
        // Esc é o atalho do Sonner para recolher a pilha de avisos
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape" }));
        const back = origin?.isConnected ? origin : document.getElementById("conteudo");
        if (!back) return;
        returned = back;
        focusVisibly(back);
        return;
      }

      // Logo depois de sair do aviso: o Tab segue a página sem entrar nele de novo
      if (active && active === returned && document.querySelector(TOASTER)) {
        const all = tabbables();
        const step = event.shiftKey ? -1 : 1;
        const at = (i: number) => all[(i + all.length) % all.length];
        const start = all.indexOf(active);
        if (start < 0) return;
        if (!at(start + step)?.closest(TOASTER)) return; // o caminho normal já não passa pelo aviso
        // Pula todas as paradas do aviso e segue para o próximo elemento da página
        let next: HTMLElement | undefined;
        for (let n = 2; n <= all.length; n++) {
          const candidate = at(start + step * n);
          if (candidate && !candidate.closest(TOASTER)) {
            next = candidate;
            break;
          }
        }
        if (!next || next === active) return;
        event.preventDefault();
        returned = null;
        focusVisibly(next);
      }
    }

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  return null;
}
