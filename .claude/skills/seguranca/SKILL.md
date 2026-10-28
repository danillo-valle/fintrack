---
name: seguranca
description: A segurança do FinTrack contra o OWASP Top 10:2025 (ADR-020) - o documento item por item, o ZAP passivo e o OSV-Scanner no CI, a CSP com nonce e hash, os eventos de segurança do login, a trava do SQL e as ações presas pelo commit. Use ao criar rota pública, mexer em cabeçalhos ou na CSP, acrescentar ou atualizar dependência, mexer no login, no log ou em scripts/zap, quando o ZAP ou o OSV barrarem um PR, ou ao revisar a segurança de uma funcionalidade.
---

# Segurança do FinTrack

Leia antes: `docs/seguranca/owasp-top10-2025.md` (cada item, a prova e as pendências) e
`docs/adr/0020-seguranca-continua.md` (as decisões). O que fazer quando o CI barra: runbook,
seção "Segurança".

## Regras

1. **O documento anda junto com o código.** Funcionalidade que mexe num item do OWASP (acesso,
   cabeçalho, dependência, login, log, erro) atualiza a linha dele em
   `docs/seguranca/owasp-top10-2025.md` no mesmo PR, com o arquivo e o teste que provam.
2. **Rota pública nova** (sem sessão): o caminho EXATO em `PUBLIC_ENDPOINTS`
   (`apps/web/src/lib/auth/routes.ts`), nunca um prefixo; e uma linha no job `requestor` de
   `scripts/zap/plano.yaml`, para o ZAP passar por ela (o spider não acha rota sem link).
3. **CSP** (`apps/web/src/lib/security-headers.ts`): nunca `'unsafe-inline'` em `script-src` nem
   em `style-src-elem` de produção. Biblioteca nova que injeta `<style>` sem nonce: o hash exato do
   texto em `INLINE_STYLE_HASHES`, com um teste que calcula o hash do pacote instalado (como o do
   sonner em `security-headers.test.ts`). Atualizou o sonner e o teste falhou: troque o hash pelo
   que o teste mostra e confira os avisos na tela.
4. **Dependência**: o OSV-Scanner barra o PR com qualquer vulnerabilidade conhecida. Corrija
   atualizando (`pnpm update -r <pacote>`, `uv lock --upgrade-package <pacote>`); `overrides` no
   `pnpm-workspace.yaml` só com o motivo na linha. Exceção no `osv-scanner.toml` só presa ao pacote
   e à versão, com motivo e `effectiveUntil`, e quando o código vulnerável não roda no FinTrack.
   Pacote com menos de 1 dia não entra (`minimumReleaseAge`). CLI de desenvolvimento vai em
   `devDependencies`.
5. **ZAP**: alerta de risco Baixo ou maior barra o PR. Exceção (`alertFilter` no plano) só com a
   prova de que a proteção existe por outro caminho (de preferência um teste) e a linha na tabela
   "Exceções em vigor" do documento. Nunca subir o `errorLevel`, tirar a rodada logada ou excluir
   telas do contexto para o CI passar. A conta da rodada logada nasce pelo caminho de verdade
   (`scripts/zap/conta-de-teste.mjs`), nunca por SQL; o cookie só por variável de ambiente.
6. **Login e log**: tentativa recusada no login vira evento pela rota `/api/auth/[...all]`
   (`apps/web/src/lib/auth/security-log.ts`). Evento de segurança novo: o nome estável, o teste, a
   regex do `security_events` em `deploy/bin/fintrack-status` e a linha na tabela do runbook. Nunca
   o corpo do pedido, e-mail inteiro, senha, código ou token no log.
7. **SQL só parametrizado**: `$queryRaw` com template ou `Prisma.sql`. O ESLint recusa
   `$queryRawUnsafe`, `$executeRawUnsafe` e `Prisma.raw` (`RAW_SQL_RESTRICTIONS` em
   `packages/config/eslint.mjs`, na mesma regra da trava de dinheiro: uma lista só).
8. **CodeQL** (configuração padrão do GitHub, sem arquivo no repositório): alerta barra o PR.
   Corrija o código. Falso positivo só é dispensado (`gh api -X PATCH .../code-scanning/alerts/N`,
   `dismissed_reason` e `dismissed_comment` com o motivo) com a linha na tabela "Exceções do
   CodeQL" do documento e um comentário no código. Em teste, tire o padrão (valor escrito à mão)
   em vez de dispensar. Nunca desligue a regra nem a análise.
9. **CI**: ação nova do GitHub entra presa pelo commit, com a versão no comentário
   (`uses: dono/acao@<sha40> # vX.Y.Z`); o Dependabot propõe as versões novas.
10. **Erro**: falha fechada (dúvida no crachá = 404; webhook responde igual para tudo); a tela de
    erro mostra o código do log (o `digest`), nunca a mensagem ou a pilha do erro.

## Conferir

```bash
pnpm --filter @fintrack/web exec vitest run src/lib/security-headers.test.ts src/lib/auth
pnpm --filter @fintrack/web exec playwright test e2e/cabecalhos.spec.ts --project=desktop
bash scripts/zap/varrer.sh http://localhost:3000 relatorios-zap   # com a IMAGEM no ar (runbook)
```
