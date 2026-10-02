// Descreve o aparelho de uma sessão a partir do "user agent" (o texto que o navegador manda
// em toda requisição). É só para a pessoa reconhecer as próprias sessões: um user agent pode
// ser inventado, então nunca use isto para decidir acesso.

const BROWSERS: [RegExp, string][] = [
  [/Edg\//, "Edge"],
  [/OPR\//, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Firefox\//, "Firefox"],
  [/Chrome\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "Mac"],
  [/CrOS/, "Chromebook"],
  [/Linux/, "Linux"],
];

export function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) return "Aparelho desconhecido";
  const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(userAgent))?.[1];
  if (browser && system) return `${browser} no ${system}`;
  return browser ?? system ?? "Aparelho desconhecido";
}
