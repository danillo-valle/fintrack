// Envio de e-mail por SMTP. Em desenvolvimento, o SMTP é o Mailpit (compose.yml):
// nada sai da sua máquina, e as mensagens aparecem em http://localhost:8025.
// Em produção (M05), o mesmo código fala com um provedor de verdade, só trocando o .env.
import nodemailer from "nodemailer";
import type { EmailMessage } from "./email-templates";
import { env } from "./env";

const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE === "true",
  auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? "" } : undefined,
});

export async function sendEmail(to: string, message: EmailMessage): Promise<void> {
  await transport.sendMail({ from: env.EMAIL_FROM, to, ...message });
}
