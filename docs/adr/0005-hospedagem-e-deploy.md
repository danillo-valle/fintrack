# ADR-005: Hospedagem, deploy e operação

- **Status:** aceita
- **Data:** 2026-10-03
- **Módulo:** M05

## Contexto

O FinTrack precisa ficar no ar fora da rede de casa, com HTTPS (as passkeys exigem), deploy
automático a cada merge na `main` e backup testado. Restrições combinadas para o projeto:

- **Custo mínimo**: só o domínio é pago (`.com.br` no Registro.br, R$ 40 por ano). Todo o resto
  precisa caber em planos gratuitos.
- **Reproduzível**: ninguém instala nada no celular ou no notebook para usar o app; e toda a
  produção nasce de arquivos versionados, numa máquina qualquer com Ubuntu 24.04 e Docker.
- **Dados financeiros reais a partir do M12**: o desenho já precisa tratar backup, cifragem e
  acesso como se fossem reais.
- O roteiro de 29/09 previa uma VPS (~US$ 7/mês) e um repositório privado `fintrack-deploy`.

Opções pesquisadas em outubro de 2026 (preços mudam; confira antes de decidir de novo):

| Opção                                | Custo/ano               | Contra                                                                                                                        |
| ------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Servidor de casa + Cloudflare Tunnel | R$ 40 (domínio)         | Cai junto com a luz ou a internet de casa; a Cloudflare termina o TLS (vê o tráfego decifrado)                                |
| Servidor de casa + Tailscale Funnel  | R$ 0                    | Banda limitada e endereço `*.ts.net`; mesma dependência da casa                                                               |
| VPS RackNerd 2 GB (promoção anual)   | US$ 35,99, sem reajuste | Provedor econômico, sem data center no Brasil                                                                                 |
| Hostinger KVM 1 (São Paulo)          | ~R$ 336 no 1º ano       | Renovação sobe para R$ 40–50/mês                                                                                              |
| Hetzner CX23                         | ~€ 72                   | Subiu ~38% em junho de 2026; Europa                                                                                           |
| Oracle Cloud Always Free             | R$ 0 (pede cartão)      | ARM gratuito cortado pela metade em agosto de 2026; instâncias "ociosas" podem ser recuperadas (um app de 2 pessoas é ocioso) |
| Vercel Hobby + Neon                  | R$ 0                    | Sem lugar para o serviço Python e a fila; dados em dois fornecedores; não ensina infraestrutura                               |

## Decisão

1. **Produção no servidor de casa (`home`), atrás do Cloudflare Tunnel**, no subdomínio
   `fintrack.<domínio>`. O `cloudflared` roda como container e abre uma conexão de **saída**
   até a Cloudflare: nenhuma porta aberta no roteador nem no `ufw`, e funciona com CGNAT.
   Aceitamos que a Cloudflare veja o tráfego decifrado na borda dela (é assim que o túnel
   funciona); em troca, ganhamos anti-DDoS e regras de firewall gratuitas.
2. **Produção isolada do desenvolvimento** na mesma máquina: usuário de sistema `fintrack` (sem
   login), pasta `/srv/fintrack`, projeto Compose `fintrack-prod`, banco próprio num volume
   próprio, nenhuma porta publicada, limite de memória por container.
3. **Imagens no GHCR**, construídas pelo CI: `fintrack-web` (Next.js `standalone`, usuário
   `node`, sistema de arquivos só leitura, sem capacidades de root) e `fintrack-migrate` (Prisma
   CLI). Pacotes **públicos**: o código já é público e as imagens não carregam segredo, então o
   servidor baixa sem token. Etiqueta por commit (`:<sha>`) e `:main` = última versão aprovada.
   O job `publicar` move a `:main` quando `qualidade`, `seguranca` e `imagem` passam na `main`.
   Ele não espera o `e2e` da `main`: o ruleset exige a branch atualizada antes do merge, então a
   árvore da `main` é a mesma que já passou no `e2e` do PR. Repetir a suíte só atrasaria o deploy.
4. **Deploy puxado (pull)**: o CI só publica; o servidor pergunta ao GHCR a cada minuto
   (`fintrack-update.timer`) se a `:main` mudou e faz o deploy sozinho. Nenhuma credencial do
   servidor fica no GitHub e nada precisa entrar na rede de casa.
5. **Deploy com volta automática**: imagem → arquivos de `deploy/` do mesmo commit → backup →
   `prisma migrate deploy` → troca do app → `/api/health` precisa responder `ok` **com o commit
   novo**. Se não responder, o app volta para a versão anterior e o Healthchecks avisa. A volta
   só do app é segura porque as migrações do FinTrack só acrescentam (ADR-004).
6. **Sem o repositório `fintrack-deploy`** (mudança em relação ao roteiro): compose, Caddyfile,
   scripts e unidades do systemd ficam em `deploy/`, no repositório público. Assim o CI confere
   esses arquivos em todo PR (shellcheck, `compose config`, `caddy validate`) e cada versão do
   app vem com a versão certa da sua operação. **Segredos nunca entram no Git**: ficam só em
   `/srv/fintrack/{.env,app.env,operacao.env}`, com permissão 600.
7. **Caddy dentro do servidor**, mesmo com a Cloudflare na frente: HSTS, log de acesso em JSON
   e a regra do IP do visitante, versionados. Ele confia só no `cloudflared` (endereço fixo) e
   lê o IP do `CF-Connecting-IP` (o `X-Forwarded-For` que chega da Cloudflare pode ser forjado
   no começo); repassa ao app um `X-Forwarded-For` de um valor só, que é o que o rate limit do
   Better Auth aceita. Se um dia o app for para uma VPS, o Caddy passa a emitir o certificado.
8. **Cabeçalhos**: CSP com **nonce** por requisição (gerado no `proxy.ts`, todas as páginas
   dinâmicas), `strict-dynamic`, sem `unsafe-eval` em produção. `style-src 'unsafe-inline'` é um
   compromisso aceito: Next.js, Sonner e next-themes injetam estilos, e CSS injetado não executa
   código. Cabeçalhos fixos no `next.config.ts` e HSTS no Caddy.
9. **Backup**: `pg_dump` diário às 03:30 e antes de cada deploy, cifrado com **age** usando só a
   chave **pública** no servidor. Cópia fora de casa no **Google Drive** (conta dedicada, rclone),
   30 dias. A chave privada fica no gerenciador de senhas e só aparece no teste de restauração,
   que restaura num Postgres temporário sem rede e confere migrações, dados e gatilhos.
10. **E-mail**: **Resend** (grátis: 3.000/mês, 100/dia) pelo SMTP, com o domínio verificado
    (SPF e DKIM) na Cloudflare e chave restrita a envio.
11. **Logs e monitor**: app em JSON (pino, com campos sensíveis apagados), Docker com rotação
    (5 × 10 MB por serviço). **UptimeRobot** (grátis, a cada 5 min) olha o `/api/health`
    público; **Healthchecks.io** (grátis) avisa se o backup diário não rodar e quando um deploy
    falha.

## Alternativas descartadas

- **VPS paga** (roteiro): melhor disponibilidade, mas custo anual e o pedido era gratuito. O kit
  roda igual numa VPS (apêndice do manual do M05): troca-se a porta de entrada, o resto fica.
- **Tailscale Funnel**: grátis e sem domínio, com o TLS no próprio servidor (mais privado), mas
  com banda limitada e endereço `*.ts.net`; ficou como plano B documentado.
- **Deploy empurrado (push) por SSH a partir do GitHub Actions**: exigiria a porta 22 alcançável
  de fora ou uma VPN no runner, e uma chave do servidor guardada no GitHub.
- **Watchtower** (atualiza containers sozinho): não roda migrações, não faz backup antes, não
  confere a saúde da versão nova nem volta sozinho. E o projeto foi arquivado.
- **Runner self-hosted do GitHub no servidor**: num repositório público, um PR de qualquer
  pessoa poderia executar código na máquina de casa. Proibido.
- **Gmail com senha de app** para o e-mail: dá acesso à caixa inteira e o próprio Google não
  recomenda; com domínio próprio, o Resend autentica o envio.

## Consequências

- Queda de luz ou internet em casa derruba o app; o monitor avisa e os dados ficam no backup.
  Quando a disponibilidade importar mais que o custo, a migração para uma VPS é restaurar um
  backup e seguir o apêndice (sem mudar código).
- O grupo `docker` equivale a root na máquina: por isso o usuário `fintrack` não tem login e a
  pasta `repo/` é reescrita a cada deploy (edições à mão nela são descartadas).
- Mudanças em scripts de `deploy/` valem já no deploy que as traz: o `fintrack-deploy` se
  reexecuta quando ele mesmo muda.
- Toda migração continua aditiva (ADR-004). Uma migração destrutiva quebraria a volta
  automática; nesse caso, o deploy é feito em duas etapas (expandir, depois contrair).
- As passkeys de desenvolvimento não valem em produção: são cadastradas de novo no domínio real.
- Passa a existir trabalho de operação recorrente: teste de restauração mensal (runbook) e
  conferência dos alertas.

## Referências

- Cloudflare Tunnel (cloudflared em Docker, `tunnel ready`) e `CF-Connecting-IP`
- Issue cloudflare/cloudflared#1426 (o `X-Forwarded-For` acrescenta, não substitui)
- Next.js 16, guia de Content Security Policy (`node_modules/next/dist/docs`)
- Better Auth 1.7.7, `advanced.ipAddress` (`@better-auth/core/dist/utils/ip.mjs`)
- GitHub Docs, "Working with the Container registry" (visibilidade padrão privada)
- Oracle Cloud, "Always Free Resources" (limites e recuperação de instâncias ociosas)
