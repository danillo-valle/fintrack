// Move o foco para um elemento depois que um aviso (Sonner) aparece na tela.
// Por quê esperar: o Sonner desenha o aviso num setTimeout. Com o aviso já na página, a folga
// de rolagem do globals.css (scroll-padding) cresce, e o elemento focado sobe para cima do aviso
// em vez de ficar escondido embaixo dele (WCAG 2.2, critério 2.4.11).
// Um setTimeout nosso, agendado depois do toast(), roda depois do setTimeout do Sonner.
export function focusAfterToast(getTarget: () => HTMLElement | null | undefined) {
  setTimeout(() => {
    const target = getTarget();
    if (!target) return;
    target.focus({ preventScroll: true });
    // Se o foco estava dentro do aviso (no "Desfazer"), o Sonner devolve o foco ao elemento de
    // antes assim que ele sai do aviso. Focar de novo garante que ele termine onde queremos.
    if (document.activeElement !== target) target.focus({ preventScroll: true });
    // "nearest" rola o mínimo necessário e respeita o scroll-padding
    target.scrollIntoView({ block: "nearest" });
  }, 0);
}
