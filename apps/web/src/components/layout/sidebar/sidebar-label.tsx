// O texto de um item do menu lateral. Com o menu aberto, aparece ao lado do ícone. Recolhido,
// vira uma dica clara ao lado do ícone, que surge ao passar o mouse ou chegar pelo Tab; o texto
// continua lá para o leitor de tela, então o nome do link ou botão não muda.
// O item precisa das classes "group/item relative".
export function SidebarLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="collapsed:bg-sidebar-foreground collapsed:text-sidebar collapsed:pointer-events-none collapsed:absolute collapsed:top-1/2 collapsed:left-full collapsed:z-50 collapsed:ml-3 collapsed:-translate-y-1/2 collapsed:rounded-lg collapsed:px-2.5 collapsed:py-1 collapsed:text-xs collapsed:font-semibold collapsed:whitespace-nowrap collapsed:opacity-0 collapsed:shadow-[0_8px_24px_rgb(10_13_40/0.25)] collapsed:transition-opacity group-hover/item:collapsed:opacity-100 group-focus-visible/item:collapsed:opacity-100 motion-reduce:transition-none">
      {children}
    </span>
  );
}
