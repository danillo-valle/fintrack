import type { ComponentProps } from "react";

type Props = Omit<ComponentProps<"form">, "method" | "action"> & {
  onSubmit: NonNullable<ComponentProps<"form">["onSubmit"]>;
};

// Formulário que só funciona com o React: o envio é feito pelo navegador, no onSubmit (o cliente do
// Better Auth em entrar, cadastro, 2FA, troca de senha e códigos de backup). Formulário com Server
// Action usa o ActionForm (ou a action direta no <form>), que já sai do servidor com POST.
//
// Por que existe (M10.0): sem `method`, o navegador envia por GET. Um clique antes de o React ligar
// o formulário (a página já à vista e o JavaScript ainda chegando: no N150 com a suíte inteira, num
// celular lento) mandava e-mail, senha e código na URL ("/entrar/dois-fatores?code=…"), que fica
// no histórico do navegador e nos logs do caminho. Com POST, os campos vão no corpo do pedido, para
// a própria página, que só se mostra de novo: nada é gravado e nada vaza. O formularios.spec.ts
// confere, sem JavaScript, todo formulário das telas abertas e do app.
export function ClientForm({ onSubmit, children, ...props }: Props) {
  return (
    <form {...props} method="post" onSubmit={onSubmit}>
      {children}
    </form>
  );
}
