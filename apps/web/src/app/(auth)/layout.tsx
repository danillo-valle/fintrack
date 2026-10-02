// Layout das telas de entrada (login, cadastro, 2FA...): centralizado, sem o menu do app.
// O grupo (auth) não aparece na URL: /entrar, não /auth/entrar.
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main
      id="conteudo"
      tabIndex={-1}
      className="flex min-h-dvh items-start justify-center px-4 pt-[12vh] pb-12 outline-none"
    >
      {children}
    </main>
  );
}
