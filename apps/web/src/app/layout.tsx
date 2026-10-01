import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
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
    { media: "(prefers-color-scheme: light)", color: "#f8fafd" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1016" },
  ],
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: o next-themes coloca a classe "dark" antes do React carregar
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
    >
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
