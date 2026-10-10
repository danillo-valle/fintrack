# ADR-010: Orçamento, painel e cache das somas

- Status: aceita
- Data: 2026-10-09
- Módulo: M08 (desenho no canvas D)

## Contexto

Até o M07.4 o FinTrack registrava o dinheiro, mas não respondia às perguntas de todo mês: "estou
dentro do orçado?", "este mês está acima do normal?", "vai sobrar ou faltar até março?". O M08
traz o orçamento por categoria, o painel (Início), o fluxo de caixa e a evolução mês a mês.

Exigências do módulo:

- todo número leva à lista de lançamentos que o compõe, com os filtros na URL, e a lista soma o
  mesmo valor (conferido em E2E);
- com 24 meses de dados sintéticos, o painel abre em menos de 1 s;
- `"use cache"` com invalidação por etiqueta, depois de avaliar o Cache Components do Next 16;
- WCAG 2.2 AA: gráfico com alternativa em tabela e a cor nunca como único sinal;
- o visual igual ao aprovado no canvas D (claro, escuro, celular e computador).

Decisões tomadas com o Danillo antes do código: orçado **por ambiente e por pessoa**; projeção
"**previsto + ritmo**"; horizonte de **6 meses** no fluxo; fluxo como **resultado do mês**
(parte de zero, não é saldo de conta).

## Decisão

### Orçado por ambiente, dividido por pessoa

- O orçado continua em `budget` (ambiente, categoria, mês). A divisão é uma tabela nova,
  `budget_share` (acréscimo, nada reestruturado): uma parte por pessoa do lar e, no máximo, uma
  do Compartilhado (`userId` nulo, o cartão de compras conjuntas do ADR-009). Só em ambiente
  compartilhado.
- A soma das partes é o orçado. O servidor recalcula (o total da tela é só ajuda) e o
  `setBudget` grava orçado e partes numa transação, auditada (`budget.set`, `budget.removed`).
  Valor zero sem divisão tira o orçado.
- **Regra de nível**: num ambiente e mês, ou se orça a categoria de cima ou as de baixo, nunca as
  duas (`budgetLevelConflict`). Sem ela, o painel somaria o Mercado duas vezes.
- **Copiar do mês anterior** só preenche o que falta, nunca sobrescreve, e o aviso tem
  "Desfazer" (apaga só o que a cópia criou e ninguém mudou depois).

### Os números

- O banco **soma** numa consulta agrupada por mês, ambiente, categoria, quem pagou, natureza
  (variável, fixa, parcela) e "até hoje ou depois" (`spendingRows`, `packages/db/src/dashboard.ts`).
  A regra de "Pago por" é a do ADR-009, escrita em SQL; um teste de integração confere que ela
  concorda com o core e que as somas batem com as da lista.
- O core **decide** o que cada número quer dizer, em funções puras e testadas
  (`packages/core/src/budget.ts`, `dashboard.ts`, `cashflow.ts`):
  - **previsto** = gasto até hoje + agendado depois de hoje + recorrências ainda não lançadas +
    gasto variável no ritmo (variável ÷ dias passados × dias restantes). Arredondamento meio
    para longe de zero (`divRound`), sempre em centavos `bigint`.
  - **média de 6 meses**: os 6 meses fechados antes do mês.
  - **orçado × realizado**: "Sobra", "Acima" ou "Fixa, vence dia N".
  - **evolução**: o orçado só aparece no gráfico quando cobre **todo** o gasto do recorte
    (Moradia com só a Diarista orçada não ganha um "acima" falso).
  - **fluxo de caixa**: compra no cartão conta no vencimento da fatura; transferência não entra;
    recorrência não lançada entra pelo valor previsto.
- Todo número sai com o endereço da lista (`transactionsHref`), montado pelo mesmo
  `filtersToQuery` que a lista usa para ler. Um total que soma categorias diferentes (o total
  do orçamento) não tem lista única: cada linha tem a sua.
- A lista mostra o **caminho de volta** ("Voltar para Orçamento · Mercado", parâmetro `volta`,
  aceito só para as telas do painel: nunca vira redirecionamento aberto) e os **filtros ativos**
  com um × para tirar cada um.
- O filtro de categoria da lista passa a incluir as categorias de baixo (Alimentação mostra
  Mercado e Padaria), para o número do painel e a lista concordarem.

### Cache Components

- `cacheComponents: true` no `next.config.ts`. As somas (gasto, recorrências, orçados, fluxo e a
  árvore de categorias) ficam em funções `"use cache"` com `cacheLife("minutes")` e a etiqueta
  `financas:<lar>` (`features/budget/server/data.ts`). A chave é o escopo (as carteiras que a
  pessoa vê) e o dia; o conteúdo, só números e ids. Nomes são lidos sem cache.
- Toda Server Action que muda dinheiro (lançamentos, contas, categorias, orçado) chama
  `financeChanged`, que faz `updateTag` da etiqueta do lar: a próxima tela já vem com o número
  novo (ler o que acabou de escrever).
- O resto do app continua gerado a cada acesso: toda tela começa pela sessão. Por isso o layout
  raiz tem `instant = false` (o nonce da CSP precisa estar no HTML) e a checagem de "navegação
  instantânea" do dev fica só nas telas que pedirem (`instantInsights.validationLevel:
"manual-warning"`). A rota `/api/health` usa `connection()` no lugar de
  `dynamic = "force-dynamic"`, que o Cache Components não aceita.

### Visual e acessibilidade

- Abas "Orçamento do mês | Fluxo de caixa | Evolução" como links (cada aba é uma página).
- Barra cheia = já aconteceu; **listrada** = previsto (utility `hatch`); traço = orçado;
  losango = mês passado; traço laranja = média. A legenda escreve cada marca, e cada gráfico tem
  nome completo (`role="img"` com `aria-label`) e uma tabela com os mesmos números ("Gráfico |
  Tabela").
- Contraste das cores novas (tinta do tom, listra forte, alerta) no `theme-contrast.test.ts`;
  axe em todas as telas novas e no modal "Editar valores"; área de toque de 24 px nos valores.

## Alternativas consideradas

- **Orçado só por ambiente** (sem pessoa): mais simples, mas não responde "quanto o Caio gastou
  do Mercado". Descartada pelo Danillo.
- **Previsto = só o que está lançado ou agendado**: subestima o mês até o fim; o ritmo é o que o
  canvas mostrou e foi escolhido.
- **Fluxo como saldo projetado das contas**: exigiria saldo inicial confiável de cada conta, que
  ainda não existe (Open Finance é do M09). O resultado do mês, a partir de zero, é honesto com
  os dados que há.
- **`unstable_cache` ou `experimental.useCache`**: o primeiro foi substituído pelo `"use cache"`;
  o segundo está obsoleto no Next 16. O Cache Components é o caminho suportado.
- **Guardar os totais em tabela** (materializar): duplicaria o que se calcula, contra o ADR-004.
  A consulta agrupada com o índice `(walletId, occurredOn)` já fica em milissegundos.

## Consequências

- Uma regra a mais escrita em dois lugares (Pago por em SQL); o teste de integração que compara
  linha por linha é o que impede divergência.
- O cache é por lar: uma mudança em qualquer ambiente do lar recalcula o painel de todos do lar.
  Simples e correto; se um dia pesar, a etiqueta pode ser por carteira.
- Com o Cache Components, o Next guarda as 3 últimas telas escondidas no documento
  (`<Activity>`, `display: none`) em vez de desmontá-las; não há opção para desligar. Três efeitos,
  tratados de propósito:
  - **Formulários**: depois de um envio, ao esconder a tela, o `ActionForm` monta de novo (troca
    a `key`, com `useRenewWhenHidden` em `lib/use-renew-when-hidden.ts`): aviso e campos voltam ao
    início. Rascunho sem envio continua (é a vantagem da preservação). A Server Action vai direta
    do `useActionState` para o `<form action>`, sem função em volta: embrulhada, o HTML do servidor
    sai com `action="javascript:throw…"` e um clique antes do React carregar se perde. Foi o
    primeiro desenho (`useFreshActionState`) e falhou no N150, onde a página demora a hidratar
    (o `data-hydrated` marca só a moldura; o conteúdo vem em Suspense e hidrata depois).
    `formularios.spec.ts` confere os dois lados.
  - **Sair da conta** continua com recarga inteira (`navigateAfterAuthChange`), então nada de uma
    pessoa fica na memória da página da outra.
  - **Testes E2E**: seletores que não sejam por papel podem achar a tela escondida; usam
    `.filter({ visible: true })` (e o `formAlert` dos helpers já filtra).
- **O tempo do painel é medido no build de produção** (`PLAYWRIGHT_PRODUCTION=1`, a imagem local do
  M05), não no `pnpm dev`. No dev, a compilação sob demanda e o React de desenvolvimento dividem a
  CPU com o navegador: a mesma tela oscilou entre 0,6 e 1,5 s no laboratório e ficou em ~1,05 s no
  N150, sem mudança de código. No build de produção do laboratório, com 24 meses: medianas de
  0,2 a 0,3 s nas quatro telas. O teste dos 24 meses é pulado no `pnpm dev` (e no CI).
- **A moldura hidrata antes do conteúdo**: o conteúdo de cada página está na fronteira de Suspense
  do `loading.tsx` e hidrata 0,1 a 0,3 s depois (produção, laboratório). Uma tecla digitada nesse
  meio-tempo some (a hidratação devolve o valor do React ao campo). Para quem usa, o intervalo é
  curto demais para pesar; nos testes, o `openPage` espera cada campo e botão à vista estar ligado
  ao React (`waitForControls` nos helpers), e não só o `data-hydrated` da moldura.
- **Pendência (do Next, não resolvida aqui)**: no build de produção, um formulário enviado antes do
  React carregar chega ao servidor e a action roda, mas a página que volta acusa diferença de
  hidratação (React #418) e o React refaz a tela sem o aviso de confirmação. Acontece também com o
  `ActionForm` do M07.4, então vem do Cache Components com o envio sem JavaScript. No `pnpm dev`
  o aviso aparece. O risco é a pessoa não ver o "registrado" e enviar de novo; com o intervalo de
  hidratação acima, é raro. `formularios.spec.ts` prova o que é nosso (o envio chega e a resposta
  traz o resultado). Rever a cada versão do Next.
- O servidor de desenvolvimento usa mais memória (no laboratório, até ~5 GB no fim da suíte
  E2E). No N150 (15 GiB) cabe; o manual pede para fechar outros `pnpm dev` antes do `pnpm e2e`.
- No Orçamento do mês, o canto do cabeçalho é o mês (como no canvas D), sem o botão "Novo
  lançamento" no computador; no celular, o "+" continua. As outras telas mantêm o botão.
- O seed ganhou a divisão do Mercado e o `SEED_VIEWER_EMAIL`, que põe uma conta de TESTE na casa
  do exemplo para ver o painel com 24 meses (o seed continua sem criar login).
- Diferenças conscientes em relação ao canvas: a terceira coluna do fluxo chama "Faturas e outras
  saídas" (o canvas dizia "Faturas e parcelas", mas a coluna também tem débitos e Pix que não
  são fixos); o total do orçamento não é link (soma categorias diferentes); a tela "Editar
  valores" foi desenhada depois, na prancha D-Editar.
