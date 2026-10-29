# ADR-021: E2E em escala: o build de produção em 3 partes no CI

- Status: aceita
- Data: 2026-10-25
- Módulo: M12.2

## Contexto

Até o M12.1, o job `e2e` do CI rodava os 547 testes de ponta a ponta (os dois aparelhos) num job
só, contra o `pnpm dev`, com limite de 25 minutos e duas novas tentativas por teste. Três problemas
apareceram:

1. **O `pnpm dev` não é o que vai para a produção.** Ele compila cada tela na primeira visita, usa a
   CSP de desenvolvimento (que libera o `<style>` sem nonce) e, desde o Next.js 16.4, pode entrar num
   laço de recarga quando sobe com o cache da rodada anterior (M12.1, revisão 2). Erros que só
   existem no build de produção passavam; falhas que só existem no dev atrapalhavam.
2. **Um job só chega perto do limite.** Cada módulo acrescentou testes; o job já levava mais de 15
   minutos e uma máquina lenta do GitHub o derrubava (M11.1).
3. **A prova de uma falha sumia.** O "filme" do teste (trace) só era gravado na repetição, e o
   relatório só era guardado quando o job falhava: um teste instável que passava na segunda vez não
   deixava rastro.

O roteiro do M12 pedia "a suíte E2E completa no CI com sharding, trace na falha e axe em todas as
páginas". Em 23/10 ficou decidido que não haveria demonstração no ar, só capturas no README. E o
Next.js 16.4 passou a avisar, em todo build, que o `partialPrefetching` precisa ser escolhido.

## Decisão

Decidido pelo Danillo em 25/10/2026 (as recomendações, menos o vídeo):

1. **No CI, a suíte roda contra o build de produção**: o servidor standalone, montado como o
   Dockerfile monta a imagem (`apps/web/e2e/production-server.ts`), sem Docker. O build é feito uma
   vez (job `e2e-build`) e as **3 partes** (`e2e-parte`, `--shard=N/3`) testam o mesmo artefato,
   cada uma com o próprio Postgres e Mailpit. O job `e2e-dev` roda só os testes do `pnpm dev` (o
   catálogo `/dev/ui`, etiqueta `@dev`). Os testes de integração do banco e o seed num banco limpo
   saíram para o job `integracao`. O job `e2e`, que o ruleset exige, junta os relatórios num só e
   reprova se qualquer um dos outros falhou.
2. **O trace da primeira falha fica sempre** (`retain-on-first-failure` no CI), mesmo quando a
   repetição passa: um teste instável aparece como "flaky" no relatório, com a prova. O relatório
   HTML juntado é guardado por 14 dias em todo run (artefato `relatorio-playwright`).
3. **`partialPrefetching: true`** (o padrão da próxima versão maior do Next.js). O app não usava
   `prefetch={true}`, então não havia prefetch antigo a migrar. As telas leem a sessão, e o Next
   guarda essa "casca" por sessão no navegador; o Sair recarrega a página inteira e a descarta.
4. **Só capturas no README**, sem vídeo e sem demonstração no ar: `pnpm capturas`
   (`playwright.capturas.config.ts`) grava as telas da casa fictícia do seed, nos temas claro e
   escuro, no computador e no celular, em `docs/capturas/`.
5. **axe em todas as telas, com uma trava**: toda rota de `apps/web/src/app` passa por uma
   conferência do axe, ou pela lista `PAGES`/`PUBLIC_PAGES` (claro e escuro) ou dentro do teste do
   fluxo que leva até ela (as 11 telas que só existem no meio de um fluxo, como o código do bot ou a
   conferência de uma importação). A auditoria do M12.2 (cada chamada do axe numa rodada inteira,
   comparada com as 44 rotas) mostrou que nenhuma faltava; o `e2e/cobertura-axe.spec.ts` passa a
   reprovar a tela nova que não entrar em nenhum dos dois.

## Consequências

- O E2E passa de 1 job para 7 (`integracao`, `e2e-build`, as 3 partes, `e2e-dev` e o `e2e`), em
  paralelo e sem custo: o repositório é público.
- Em casa, `pnpm e2e` continua no `pnpm dev` (rápido para escrever teste). `pnpm e2e:producao` faz o
  build e roda a suíte inteira contra ele, como o CI.
- Teste que só faz sentido no `pnpm dev` leva a etiqueta `@dev` (`DEV_ONLY` em `helpers.ts`); sem
  ela, ele seria pulado no CI sem ninguém perceber.
- O teste que mede tempo (o painel de 24 meses), que só roda no build de produção, passa a rodar em
  todo PR.
- O app que os testes sobem não depende da internet: além das APIs de mentira, a consulta de senhas
  vazadas fica desligada (`HIBP_CHECK: "off"` no `playwright.config.ts`, como no CI). Com ela
  ligada pelo `.env` de casa, um cadastro esperou a internet por mais de 5 s e o teste falhou.
- Uma falha agora é lida no relatório juntado: Actions › o run › Artifacts › `relatorio-playwright`
  (runbook, "O CI barrou o PR por causa do E2E").

## Alternativas consideradas

- **A suíte contra a imagem Docker**: o job `imagem` já prova a imagem (teste de fumaça e ZAP). Subir
  a imagem em cada parte pediria construí-la três vezes (ou publicá-la antes do merge) e uma rede
  entre containers; o servidor standalone é o mesmo código, com o mesmo Node.
- **Um build por parte**: mais simples, mas três builds diferentes do mesmo commit, e mais tempo de
  máquina. O artefato do `e2e-build` garante que as três partes testam a mesma coisa.
- **Continuar no `pnpm dev`, só dividido**: mais rápido de adotar, mas manteria os três problemas do
  contexto, menos o tempo.
- **Vídeo no README**: um MP4 só toca dentro do README se for enviado pela página do GitHub (não por
  commit), e um GIF passa de vários MB. As capturas estáticas bastam para mostrar as telas.

## Revisão do M12.3b (28/10/2026)

**Continua valendo.** A suíte inteira contra o build de produção em 3 partes, o `e2e-dev`, o
relatório juntado e o axe em todas as telas (573 testes no M12.3a).

- **Em aberto:** tirar o `turbopackFileSystemCacheForDev: false` quando o Next corrigir o laço
  de recarga (pendências do README).
