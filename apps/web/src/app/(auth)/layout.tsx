import { Check } from "lucide-react";

const POINTS = [
  "Lançar um gasto leva menos de 10 segundos.",
  "Cada carteira mostra só o que é dela.",
  "Entrar pede a senha e o código do celular.",
];

// Layout das telas de entrada (login, cadastro, 2FA...), sem o menu do app.
// O grupo (auth) não aparece na URL: /entrar, não /auth/entrar.
// Visual Elétrico (M07.2): a partir de 1024 px, o painel elétrico à esquerda apresenta o app e o
// formulário fica à direita; no celular, só o brilho no fundo, para o formulário caber na tela.
// Sem brilho branco no canto de baixo: sob o texto ele clareava o azul e reprovava no axe (3,8:1).
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="app-glow min-h-dvh lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside
        aria-label="Sobre o FinTrack"
        className="bg-hero text-hero-foreground relative isolate hidden overflow-hidden p-12 lg:flex lg:flex-col lg:justify-between"
      >
        <span
          aria-hidden
          className="bg-highlight pointer-events-none absolute -top-48 -right-48 -z-10 size-96 rounded-full opacity-30 blur-3xl"
        />
        <p className="flex items-center gap-2 text-lg font-semibold">
          <svg aria-hidden viewBox="0 0 32 32" className="size-8">
            <rect width="32" height="32" rx="8" fill="#ffffff" />
            <path d="M10 8h13v4H14v3h7v4h-7v5h-4z" className="fill-hero" />
            <circle cx="23" cy="22" r="2.5" className="fill-hero" />
          </svg>
          FinTrack
        </p>
        <div className="flex max-w-md flex-col gap-6">
          <p className="text-5xl leading-[1.05] font-bold tracking-tight text-balance">
            As finanças da casa, em dia.
          </p>
          <ul className="flex flex-col gap-3 text-base">
            {POINTS.map((point) => (
              <li key={point} className="flex items-start gap-3">
                <span className="bg-highlight text-highlight-foreground mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full">
                  <Check aria-hidden className="size-4" />
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm">Só para quem foi convidado.</p>
      </aside>
      <main
        id="conteudo"
        tabIndex={-1}
        className="flex min-h-dvh items-start justify-center px-4 pt-[12vh] pb-12 outline-none lg:items-center lg:pt-12"
      >
        {children}
      </main>
    </div>
  );
}
