import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { Providers } from "@/components/providers";
import { NONCE_HEADER } from "@/lib/security-headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // "%s" é trocado pelo título de cada página: "Lançamentos · FinTrack"
  title: { default: "FinTrack", template: "%s · FinTrack" },
  description: "Controle financeiro da casa",
  applicationName: "FinTrack",
  appleWebApp: { capable: true, title: "FinTrack", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  // Cor da barra do navegador no celular, acompanhando o tema
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f5fc" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0d18" },
  ],
  viewportFit: "cover",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Nonce desta requisição, sorteado pelo proxy.ts (CSP). O next-themes precisa dele no script
  // que aplica o tema antes da página aparecer; sem o nonce, a CSP bloquearia esse script.
  // Ler headers() aqui torna TODAS as páginas dinâmicas (geradas a cada acesso), e é isso que
  // queremos: página gerada no build não tem como receber um nonce novo a cada visita.
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;

  return (
    // suppressHydrationWarning: o next-themes coloca a classe "dark" antes do React carregar
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
    >
      <body className="min-h-full">
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
