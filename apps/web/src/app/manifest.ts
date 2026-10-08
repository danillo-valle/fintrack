import type { MetadataRoute } from "next";

// Manifesto do app: permite instalar o FinTrack na tela inicial do celular.
// O Next.js serve este arquivo em /manifest.webmanifest.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FinTrack",
    short_name: "FinTrack",
    description: "Controle financeiro da casa",
    lang: "pt-BR",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f3f5fc",
    theme_color: "#2f5bff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
