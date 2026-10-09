// O texto de um item do menu lateral. Com o menu aberto, aparece ao lado do ícone. Recolhido,
// vira uma dica que surge ao passar o mouse ou chegar pelo Tab; o texto continua lá para o leitor
// de tela, então o nome do link ou botão não muda. O item precisa das classes "group/item relative".
export function SidebarLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="collapsed:bg-foreground collapsed:text-background collapsed:pointer-events-none collapsed:absolute collapsed:top-1/2 collapsed:left-full collapsed:z-50 collapsed:ml-3 collapsed:-translate-y-1/2 collapsed:rounded-md collapsed:px-2.5 collapsed:py-1 collapsed:text-xs collapsed:font-medium collapsed:whitespace-nowrap collapsed:opacity-0 collapsed:shadow-lg collapsed:transition-opacity group-hover/item:collapsed:opacity-100 group-focus-visible/item:collapsed:opacity-100 motion-reduce:transition-none">
      {children}
    </span>
  );
}
