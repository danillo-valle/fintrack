# ADR-003: Autenticação com Better Auth, Prisma 7 e 2FA obrigatório

- **Status:** aceita
- **Data:** 2026-10-02
- **Módulo:** M03

## Contexto

O FinTrack guarda dados financeiros de duas pessoas e vai ficar exposto na internet (M05).
Precisa de login forte, cadastro restrito às duas pessoas da casa, sessões revogáveis e uma
forma prática de entrar pelo celular. É um projeto de uma pessoa só: a solução precisa ser
mantida sem um time de segurança.

## Decisão

1. **Better Auth 1.7** dentro do próprio Next.js, com o banco no PostgreSQL via
   **Prisma ORM 7** (driver adapter `@prisma/adapter-pg`) num pacote `@fintrack/db`.
   As tabelas são geradas pelo CLI do Better Auth (`scripts/gerar-schema-auth.sh`) e aplicadas
   por migração do Prisma.
2. **E-mail e senha** com confirmação de e-mail obrigatória e política do NIST SP 800-63B-4 para
   senha usada com segundo fator: mínimo de 8, máximo de 128, sem regras de composição nem troca
   periódica, e recusa de senhas vazadas (plugin `haveIBeenPwned`, k-anonimato).
3. **2FA por TOTP obrigatório** para todas as contas, com 10 códigos de backup. Nenhuma página do
   app abre sem ele (`requireUser()` manda para `/configurar-2fa`).
4. **Passkeys (WebAuthn)** como forma principal de entrar no celular.
5. **Google (OAuth 2.0 com PKCE)** opcional, só para contas que já existem
   (`disableImplicitSignUp`), ligando pelo e-mail.
6. **Cadastro fechado** por um hook `databaseHooks.user.create.before` que recusa e-mails fora de
   `ALLOWED_EMAILS`. A resposta da tela é a mesma de um cadastro aceito (não revela a lista).
7. **Proteção em camadas:** `proxy.ts` só redireciona; a barreira é `requireUser()` em toda página
   e Server Action. Ações sensíveis exigem prova de identidade dos últimos 10 minutos, conferida
   no servidor (hook do Better Auth e `requireRecentAuth()`).
8. **Limite de tentativas** guardado no banco: 5 logins por minuto por IP, bloqueio de 15 minutos
   depois de 10 códigos de 2FA errados (padrão do plugin), 5 reautenticações erradas por 15 minutos,
   5 trocas de senha por minuto.
9. **Senha esquecida e senha trocada:** quem esqueceu recebe um link por e-mail (vale 1 hora, uso
   único) e todas as sessões caem. Quem lembra troca em Ajustes → Segurança: a senha atual é a
   prova de identidade (sem passar pela reautenticação), as sessões nos outros aparelhos caem por
   padrão e um e-mail avisa a troca.

## Alternativas consideradas

- **Auth.js (NextAuth):** madura, mas 2FA, passkey e cadastro por e-mail exigem bastante código
  próprio; o Better Auth traz os três como plugins.
- **Serviço gerenciado (Clerk, Auth0):** menos código, mas dados de login fora da infraestrutura
  do projeto, custo por usuário e menos aprendizado.
- **Prisma 8:** o `prismaAdapter` do Better Auth ainda exige o Prisma Client do 7.
- **2FA opcional:** mais simples, mas a conta com só senha seria o elo fraco.
- **Mostrar "e-mail não autorizado" no cadastro:** mais claro, porém revelaria quais e-mails estão
  na lista. O comportamento padrão do Better Auth foi mantido.

## Consequências

- Toda página nova do app precisa chamar `requireUser()`; um teste unitário reprova quem esquecer.
- O `BETTER_AUTH_SECRET` cifra o segredo do TOTP no banco: perder ou trocar o segredo invalida os
  2FA já ligados. Ele vai para o backup do M05 junto com o banco.
- O limite de tentativas usa o IP do cabeçalho `X-Forwarded-For`. Em produção (M05), o Caddy
  sobrescreve esse cabeçalho e `advanced.ipAddress.trustedProxies` passa a apontar para ele;
  sem isso, um atacante poderia trocar de "IP" a cada tentativa.
- Passkeys só funcionam em HTTPS ou em `localhost`: pelo IP da rede de casa, só a partir do M05.
- O e-mail de desenvolvimento vai para o Mailpit; o provedor real entra no M05, só trocando o `.env`.
