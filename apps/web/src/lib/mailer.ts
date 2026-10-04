// Envio de e-mail por SMTP. Em desenvolvimento, o SMTP é o Mailpit (compose.yml):
// nada sai da sua máquina, e as mensagens aparecem em http://localhost:8025.
// Em produção (M05), o mesmo código fala com o Resend (smtp.resend.com, porta 465), só trocando
// o /srv/fintrack/app.env. Cada envio e cada falha vão para o log JSON (sem o e-mail completo).
import nodemailer from "nodemailer";
import type { EmailMessage } from "./email-templates";
import { env } from "./env";
import { logger, maskEmail } from "./logger";

const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE === "true",
  auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? "" } : undefined,
});

export async function sendEmail(to: string, message: EmailMessage): Promise<void> {
  try {
    await transport.sendMail({ from: env.EMAIL_FROM, to, ...message });
    logger.info(
      { event: "email.sent", to: maskEmail(to), subject: message.subject },
      "E-mail enviado",
    );
  } catch (error) {
    // Senha de app errada, Gmail recusando, rede fora: aparece no log com o motivo.
    // O erro continua subindo: quem chamou (Better Auth) decide o que mostrar na tela.
    logger.error(
      { event: "email.send_failed", to: maskEmail(to), subject: message.subject, err: error },
      "Falha ao enviar e-mail",
    );
    throw error;
  }
}
