---
name: arquitetura
description: A arquitetura documentada do FinTrack (ADR-023) - o mapa do fluxo gerado do código (packages/flow-map, docs/arquitetura/fluxo.json), o C4 em Mermaid, o site "FinTrack por dentro" no GitHub Pages, a revisão dos ADRs e o relatório com nota. Use ao criar ou mudar uma tela, Server Action, rota de API, fila ou chamada de rede, quando o teste do mapa barrar um PR, ao mexer em docs/arquitetura, em packages/flow-map ou no site, ou ao revisar um ADR.
---

# Arquitetura documentada (ADR-023)

O fluxo do app não é escrito à mão: o `packages/flow-map` lê o código e grava
`docs/arquitetura/fluxo.json`; o site do GitHub Pages e o "quem usa" saem desse arquivo, e os
testes do pacote (no `pnpm check`) conferem que ele está em dia.

## Mudou uma tela, action, rota, fila ou serviço

1. Rode `pnpm --filter @fintrack/flow-map generate` e faça commit do `fluxo.json` junto. O diff
   mostra no PR o que mudou no fluxo (revise: é a melhor descrição da mudança).
2. Se o teste do mapa barrar, a mensagem diz o quê:
   - **"está em dia"**: faltou o passo 1;
   - **"toda Server Action exportada é chamada por alguma tela"**: action morta (apague) ou
     chamada de um jeito que o mapa não segue (import dinâmico, passada por variável): chame do
     componente pelo import direto;
   - **"todo link e todo redirect levam a uma tela que existe"**: link quebrado de verdade, ou
     montado com texto solto: use uma constante de rota ou um template com a rota no começo;
   - **"pede a sessão"**: tela ou action sem `requireUser()` (skill `auth-guard`);
   - **"chamada de rede está na lista"**: arquivo novo que fala com a internet entra em
     `SERVICES` (`packages/flow-map/src/services.ts`) com o nome e a descrição do serviço.
3. Nunca edite o `fluxo.json` à mão, nem tire um teste do mapa para o PR passar.

## Como o mapa enxerga o código

- Só sintaxe (o compilador do TypeScript sem o verificador de tipos): nada roda.
- Segue cada nome até a declaração, por símbolo (`symbols.ts`): um componente de um arquivo com
  vários só traz o que ele mesmo usa.
- Tela: para em `features/*/server` (vira "carregamento") e em `"use server"` (vira action);
  segue os componentes do navegador (`"use client"`), sem descer nos primitivos de `components/ui`.
- Servidor: desce pelo app e pelo `packages/importers`; no `packages/db` anota a função e as
  tabelas (`prisma.<modelo>`, `db.`, `tx.` e o SQL de `$queryRaw`); no `packages/core`, a regra.
  Para no `lib/env.ts`, no `lib/logger.ts` e no Better Auth (só a rota `/api/auth` o segue); o
  `requireUser`/`requireRecentAuth` vira o campo `session`.
- Constantes de texto (`PAGE`, `QUEUES.x.name`) são seguidas até o literal.
- Mudou a regra de análise? Teste com o repositório de mentira (`analyze.test.ts`) antes, e prove
  por mutação que o teste pega o erro.
- Texto lido (rota, schema, SQL, Markdown, SVG) passa uma vez só: pedaço por pedaço
  (`routes.ts`), linha por linha ou por posição (`indexOf`). Regex só ancorada (`^…$`) e sobre
  um pedaço curto; nunca `/g` com repetição sem âncora nem `new RegExp` com nome do código. O
  CodeQL acusa (`js/polynomial-redos`, M12.3b) e cada leitor tem um teste "não fica lento" com
  100 mil repetições (`testing/timing.ts`).

## O C4 e o site

- O C4 é Mermaid em `docs/arquitetura/c4.md` (`flowchart` com a notação do C4; a sintaxe
  `C4Context` embaralha os rótulos). Contêiner, rede ou peça nova muda o diagrama no mesmo PR.
- O site (`packages/flow-map/src/site`): `pnpm --filter @fintrack/flow-map site` monta em
  `dist/site` (o C4 vira SVG; diagrama com erro para o build), `site:serve` serve em
  `http://127.0.0.1:4173/fintrack/` e `test:site` roda o Playwright com o axe.
- Visual igual à linha K do canvas; mudança de visual passa pelo canvas antes (skill
  `ui-componentes`). Nada de fora (fontes no próprio site), nada inline (CSP na meta), DOM sem
  `innerHTML`, e nenhum dado de pessoa: só nomes do código.
- O CI: o job `site` monta e testa; o `e2e` confere o resultado dele; o `pagina` publica só da
  `main`.

## ADRs e relatório

- Decisão nova: ADR novo (`docs/adr/`), linha no README. Decisão que muda outra: o ADR antigo
  ganha um adendo apontando o novo, nunca é apagado.
- Revisão geral (antes de uma versão grande): cada ADR ganha a seção "Revisão do <módulo>" e o
  README a coluna; o que ficou em aberto vai para a lista de pendências do
  `docs/arquitetura/relatorio.md`, com a prioridade.
- O relatório mede antes de dar nota (a tabela "Como foi avaliado" diz como refazer cada número).
