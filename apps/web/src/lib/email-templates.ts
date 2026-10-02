// Textos dos e-mails do FinTrack. Funções puras: recebem os dados e devolvem assunto e corpo.
// Ficam separadas do envio (mailer.ts) para poderem ser testadas sem servidor de e-mail.

export type EmailMessage = {
  subject: string;
  text: string;
  html: string;
};

// Escapa os caracteres especiais do HTML: um nome como "<script>" vira texto, não código
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function layout(title: string, paragraphs: string[], action: { label: string; url: string }) {
  const body = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n");
  return `<!doctype html>
<html lang="pt-BR">
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #1d2433">
<h1 style="font-size: 20px">${escapeHtml(title)}</h1>
${body}
<p><a href="${escapeHtml(action.url)}" style="display: inline-block; padding: 10px 16px; background: #1e5099; color: #ffffff; border-radius: 8px; text-decoration: none">${escapeHtml(action.label)}</a></p>
<p style="font-size: 13px; color: #5a6475">Se o botão não funcionar, copie este endereço no navegador:<br>${escapeHtml(action.url)}</p>
</body>
</html>`;
}

export function verificationEmail(name: string, url: string): EmailMessage {
  const greeting = `Olá, ${name}.`;
  const lines = [
    greeting,
    "Para ativar sua conta no FinTrack, confirme que este e-mail é seu.",
    "O link vale por 1 hora. Se você não pediu, ignore esta mensagem.",
  ];
  return {
    subject: "Confirme seu e-mail no FinTrack",
    text: `${lines.join("\n\n")}\n\nConfirmar: ${url}\n`,
    html: layout("Confirme seu e-mail", lines, { label: "Confirmar e-mail", url }),
  };
}

export function resetPasswordEmail(name: string, url: string): EmailMessage {
  const lines = [
    `Olá, ${name}.`,
    "Recebemos um pedido para trocar a senha da sua conta no FinTrack.",
    "O link vale por 1 hora e só pode ser usado uma vez. Se não foi você, ignore esta mensagem: sua senha continua a mesma.",
  ];
  return {
    subject: "Troca de senha no FinTrack",
    text: `${lines.join("\n\n")}\n\nTrocar a senha: ${url}\n`,
    html: layout("Troca de senha", lines, { label: "Trocar a senha", url }),
  };
}

// Aviso depois de uma troca de senha feita por quem estava logado (tela Segurança).
// Não leva link de ação perigosa: só aponta para o "esqueci a senha", caso não tenha sido a pessoa.
export function passwordChangedEmail(name: string, when: string, resetUrl: string): EmailMessage {
  const lines = [
    `Olá, ${name}.`,
    `A senha da sua conta no FinTrack foi trocada em ${when}.`,
    "Se foi você, não precisa fazer nada.",
    "Se não foi você, alguém pode estar usando a sua conta: troque a senha agora pelo botão abaixo e encerre as sessões que não reconhecer em Ajustes > Segurança.",
  ];
  return {
    subject: "Sua senha do FinTrack foi trocada",
    text: `${lines.join("\n\n")}\n\nTrocar a senha: ${resetUrl}\n`,
    html: layout("Sua senha foi trocada", lines, {
      label: "Não fui eu: trocar a senha",
      url: resetUrl,
    }),
  };
}
