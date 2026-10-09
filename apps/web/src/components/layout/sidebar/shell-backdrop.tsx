// As luzes atrás do menu lateral de vidro (M07.3): um azul embaixo e um lima em cima, bem
// desfocados. São elas que o vidro mostra, borradas; sem nada colorido atrás, vidro parece cinza.
// Só no computador (no celular não há menu lateral) e fora da árvore de acessibilidade.
// A casca é "isolate": o -z-10 fica acima do fundo da casca e abaixo do menu.
export function ShellBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-y-0 left-0 -z-10 hidden w-96 md:block"
    >
      <span className="bg-hero absolute top-[52%] -left-32 size-[26rem] rounded-full opacity-55 blur-[70px]" />
      <span className="bg-highlight absolute -top-20 left-14 size-64 rounded-full opacity-45 blur-[70px] dark:opacity-20" />
    </div>
  );
}
