---
name: deploy-e-operacao
description: Como o FinTrack vai para produção e é operado (Dockerfile, GHCR, deploy puxado pelo servidor, Caddy, Cloudflare Tunnel, backup com age, logs pino, health check). Use ao mexer no Dockerfile, em deploy/, no ci.yml, no /api/health, em logs, em cabeçalhos de segurança, ao criar variável de ambiente nova, ao escrever migração que vai para produção, ou quando a pessoa pedir ajuda com um problema da produção.
---

# Deploy e operação do FinTrack

Leia antes: `docs/adr/0005-hospedagem-e-deploy.md` (decisões) e `docs/operacao/runbook.md`
(comandos de cada situação).

## O caminho de um merge até a produção

1. PR → CI: `qualidade`, `seguranca`, `e2e` e `imagem` (constrói `web` e `migrate`, migra um
   banco limpo e roda `deploy/bin/smoke-test` no container endurecido).
2. Merge na `main` → `imagem` publica `ghcr.io/danillo-valle/fintrack-{web,migrate}:<sha>`;
   `publicar` (com `qualidade`, `seguranca` e `imagem` verdes) aponta `:main` para elas. O `e2e`
   não é esperado: o ruleset exige branch atualizada, e essa árvore já passou nele no PR.
3. No servidor, `fintrack-update.timer` (1 min) vê a `:main` nova e roda `deploy/bin/fintrack-deploy`:
   imagens → `deploy/` do mesmo commit → backup → `prisma migrate deploy` → troca SÓ o app →
   `/api/health` precisa dizer `ok` com o commit novo → senão, volta o app para a versão anterior.

## Onde fica cada coisa

| O quê                                   | Onde                                                       |
| --------------------------------------- | ---------------------------------------------------------- |
| Imagens (alvos `web` e `migrate`)       | `Dockerfile`, `.dockerignore`                              |
| Produção (serviços, redes, limites)     | `deploy/compose.prod.yml`                                  |
| Porta de entrada, HSTS, IP do visitante | `deploy/caddy/Caddyfile`                                   |
| Scripts de operação                     | `deploy/bin/` (todos usam `deploy/bin/lib.sh`)             |
| Agendamentos                            | `deploy/systemd/*.timer`                                   |
| Modelos das variáveis de produção       | `deploy/env/*.example` (sem valores reais)                 |
| Saúde                                   | `apps/web/src/lib/health.ts` (puro) e `database-health.ts` |
| CSP com nonce                           | `apps/web/src/lib/security-headers.ts` + `src/proxy.ts`    |
| Log JSON                                | `apps/web/src/lib/logger.ts`, `src/instrumentation.ts`     |

## Regras

1. **Migração que vai para produção é aditiva** (tabela nova, coluna opcional, valor novo de
   enum). A volta automática do deploy troca só o app; a versão anterior precisa funcionar com o
   banco já migrado. Mudança incompatível = duas etapas (expandir num PR, contrair noutro). Veja
   também a skill `prisma-migration`.
2. **Variável de ambiente nova**: `.env.example`, `apps/web/src/lib/env.ts`, `globalPassThroughEnv`
   do `turbo.json` E `deploy/env/app.env.example`. No PR, avise que a pessoa precisa colocar o
   valor em `/srv/fintrack/app.env` ANTES do merge, com `sudo -u fintrack fintrack-definir app.env NOME`
   (senão o deploy falha no health e volta).
3. **Nada de segredo no Git, na imagem ou no log.** A imagem recebe tudo pelo `env_file` do
   compose. Valores de mentira no build só dentro do `RUN` (Dockerfile). O logger apaga senha,
   token, cookie e Client Secret (`REDACT_PATHS`); e-mail só com `maskEmail`.
4. **Todo log do servidor usa o `logger`** com um `event` curto e estável
   (`email.send_failed`, `health.database_failed`). Nunca `console.log`.
5. **O app não publica porta** e não sabe que existe Cloudflare: confia no `X-Forwarded-For` de
   um valor só que o Caddy monta a partir do `CF-Connecting-IP`. Não acrescente `trustedProxies`
   nem leia `CF-Connecting-IP` no app.
6. **CSP**: script de terceiro ou inline novo precisa do nonce (`headers().get("x-nonce")`) e
   passa pelo `e2e/cabecalhos.spec.ts`, que falha em qualquer violação. Nunca `unsafe-inline` em
   `script-src`, nunca `unsafe-eval` fora do dev.
7. **Depois de entrar, confirmar o 2FA ou sair**, navegue com `navigateAfterAuthChange`
   (`src/lib/navigation.ts`), não com `router.replace`: o cache de pré-carregamento do build de
   produção causava um laço no login.
8. **Scripts de `deploy/bin`**: `set -Eeuo pipefail` (vem do `lib.sh`), corpo dentro de `main()`,
   `shellcheck -x` limpo, sem `eval`. Mexeu? Rode o shellcheck e ensaie (o CI só confere sintaxe).
9. **Nunca** sugira à pessoa: `fintrack-compose down -v`, apagar o volume `fintrack-prod_db-data`,
   editar arquivos em `/srv/fintrack/repo` (o deploy descarta), runner self-hosted do GitHub,
   ou rodar o seed na produção sem que ela peça (`SEED_TARGET_HOST=db`).
10. **Antes de dizer que pronto**: `pnpm check`, `pnpm e2e` e, se mexeu em imagem ou deploy,
    `docker build --target web .` e `deploy/bin/smoke-test` contra o container.

## Problema na produção? Comece por aqui

```bash
sudo -u fintrack fintrack-status
journalctl -u fintrack-update --since "1 hour ago"
sudo -u fintrack fintrack-compose logs --since 30m --no-log-prefix web | jq -R 'fromjson? // {texto: .}'
```

Diagnostique antes de propor mudança; a resposta para quase tudo está no runbook.
