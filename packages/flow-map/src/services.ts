import type { Service } from "./model";

/**
 * As fronteiras com o mundo de fora: o arquivo que conversa com cada serviço. Um teste confere que
 * todo arquivo do app que faz uma chamada de rede está nesta lista (fronteira nova não fica de fora
 * do mapa) e que todo arquivo da lista existe.
 */
export const SERVICES: Service[] = [
  {
    id: "ml",
    name: "Serviço Python",
    description: "Fatura em PDF, classificador e IA local (FastAPI, só na rede interna)",
    files: [
      "apps/web/src/lib/ml/classifier.ts",
      "apps/web/src/lib/ml/local-ai.ts",
      "packages/importers/src/pdf/invoice.ts",
    ],
  },
  {
    id: "pluggy",
    name: "Meu Pluggy",
    description: "Contas e cartões do banco (Open Finance)",
    files: ["packages/importers/src/pluggy/client.ts"],
  },
  {
    id: "whatsapp",
    name: "WhatsApp (Meta)",
    description: "As respostas do bot pela Cloud API",
    files: ["apps/web/src/lib/whatsapp/channel.ts"],
  },
  {
    id: "telegram",
    name: "Telegram",
    description: "As respostas do bot pela Bot API",
    files: ["apps/web/src/lib/telegram/channel.ts"],
  },
  {
    id: "hibp",
    name: "Have I Been Pwned",
    description: "Senhas vazadas (só 5 caracteres do hash saem do servidor)",
    files: ["apps/web/src/lib/auth/leaked-password.ts"],
  },
  {
    id: "smtp",
    name: "E-mail (SMTP)",
    description: "Confirmação de e-mail, convite e redefinição de senha",
    files: ["apps/web/src/lib/mailer.ts"],
  },
];

/**
 * O texto que marca uma chamada de rede num arquivo (o teste procura fronteiras esquecidas): o
 * fetch chamado direto, o fetch global como padrão de um fetch injetável (globalThis.fetch ou
 * "?? fetch", o jeito dos clientes testáveis) e o transporte de e-mail.
 */
export const NETWORK_CALL =
  /\bfetch\s*\(|globalThis\.fetch\b|\?\?\s*fetch\b|\bcreateTransport\s*\(/;
