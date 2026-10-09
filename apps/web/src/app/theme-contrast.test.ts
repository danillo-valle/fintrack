// Contraste das cores do tema (WCAG 2.2 AA), conferido direto no globals.css.
//
// O axe dos testes de ponta a ponta confere as páginas prontas; este teste pega antes, em
// milissegundos, um par de cores que nunca deveria existir: texto com menos de 4,5:1 sobre o
// fundo em que ele aparece, ou anel de foco e cores de gráfico com menos de 3:1.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

// Lê as variáveis em hexadecimal de um bloco (":root {" ou ".dark {")
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`bloco ${selector} não encontrado`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const found: Record<string, string> = {};
  for (const match of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    found[match[1]!] = match[2]!.toLowerCase();
  }
  return found;
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

// Mistura uma cor com transparência sobre um fundo (como o Tailwind faz com bg-destructive/10)
function mix(fg: string, alpha: number, bg: string): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);
  return (
    "#" +
    [1, 3, 5]
      .map((i) => Math.round(alpha * channel(fg, i) + (1 - alpha) * channel(bg, i)))
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// [texto, fundo]: os pares que aparecem de verdade nas telas
const TEXT_PAIRS: [string, string][] = [
  ["foreground", "background"],
  ["foreground", "card"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["muted-foreground", "muted"],
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["income", "card"],
  ["income", "background"],
  ["expense", "card"],
  ["expense", "background"],
  ["warning", "card"],
  ["highlight-foreground", "highlight"],
  ["hero-foreground", "hero"],
  ["sidebar-foreground", "sidebar"],
  ["sidebar-muted-foreground", "sidebar"],
  ["sidebar-accent-foreground", "sidebar-accent"],
  ["sidebar-primary-foreground", "sidebar-primary"],
  // O destaque suave do resumo (M07.3): o rótulo e o valor sobre as duas pontas do degradê
  ["hero-soft-foreground", "hero-soft"],
  ["hero-soft-foreground", "hero-soft-2"],
  ["hero-soft-strong", "hero-soft"],
  ["hero-soft-strong", "hero-soft-2"],
  // A pílula do ambiente compartilhado usa a cor de gráfico 5 como TEXTO
  ["chart-5", "card"],
];

// Links e botões de texto usam a cor primária como texto (TEXT_LINK)
const PRIMARY_AS_TEXT: [string, string][] = [
  ["primary", "background"],
  ["primary", "card"],
];

// Botão "destructive" do shadcn: texto na cor cheia sobre um fundo com 10 % (claro) ou 20 %
// (escuro) da mesma cor, em cima do fundo da página. O axe reprovou isso no laboratório.
// O mesmo, com o mouse em cima (hover: 15 % no claro, 25 % no escuro; 20 % e 30 % reprovavam).
const TINTED: [string, number, number, string][] = [
  ["destructive", 0.1, 0.2, "background"],
  ["destructive", 0.15, 0.25, "background"],
];

const NON_TEXT = ["ring", "chart-1", "chart-2", "chart-3", "chart-4", "chart-5"];

describe.each([
  ["claro", ":root"],
  ["escuro", ".dark"],
])("tema %s", (_name, selector) => {
  const t = tokens(selector);
  const theme = { ...tokens(":root"), ...t }; // o escuro herda o que não redefine

  it.each([...TEXT_PAIRS, ...PRIMARY_AS_TEXT])("%s sobre %s ≥ 4,5:1", (fg, bg) => {
    expect(theme[fg], `--${fg}`).toBeDefined();
    expect(theme[bg], `--${bg}`).toBeDefined();
    expect(contrast(theme[fg]!, theme[bg]!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(TINTED)(
    "%s sobre o próprio tom (%s no claro, %s no escuro) ≥ 4,5:1",
    (fg, light, dark, bg) => {
      const alpha = selector === ":root" ? light : dark;
      const tinted = mix(theme[fg]!, alpha, theme[bg]!);
      expect(contrast(theme[fg]!, tinted)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("botão principal com o mouse em cima (primária com 12 % do texto) ≥ 4,5:1", () => {
    // o mesmo color-mix(in srgb, var(--primary), var(--foreground) 12%) do button.tsx
    const hover = mix(theme.foreground!, 0.12, theme.primary!);
    expect(contrast(theme["primary-foreground"]!, hover)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT)("%s sobre o cartão ≥ 3:1", (name) => {
    expect(contrast(theme[name]!, theme.card!)).toBeGreaterThanOrEqual(3);
  });
});

describe("regras do Visual C", () => {
  it("a lima nunca vira texto no tema claro (contraste baixo sobre branco)", () => {
    const light = tokens(":root");
    expect(contrast(light.highlight!, light.card!)).toBeLessThan(3);
    // por isso a primária do claro é o azul, não a lima
    expect(light.primary).not.toBe(light.highlight);
  });

  it.each([
    ["claro", ":root"],
    ["escuro", ".dark"],
  ])(
    "menu lateral de vidro (%s): o texto passa sobre o fundo e sobre as luzes atrás dele",
    (_name, selector) => {
      const t = { ...tokens(":root"), ...tokens(selector) };
      // O que pode estar atrás do vidro: o fundo da página ou, no pior caso, uma das luzes
      // (ShellBackdrop) pura, sem desfoque: o azul do destaque e a lima.
      const behind = [t.background!, t.hero!, t.highlight!];
      for (const backdrop of behind) {
        // o mesmo color-mix(var(--sidebar) 80%, transparent) do glass-sidebar
        const glass = mix(t.sidebar!, 0.8, backdrop);
        expect(contrast(t["sidebar-foreground"]!, glass)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t["sidebar-muted-foreground"]!, glass)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it("a fórmula confere com a referência da WCAG (preto sobre branco = 21:1)", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });
});
