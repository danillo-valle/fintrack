---
name: ui-componentes
description: Como construir telas e componentes no FinTrack com shadcn/ui, Tailwind e os tokens do tema. Use ao criar ou alterar qualquer arquivo .tsx em apps/web/src, ao adicionar um componente do shadcn, ou ao revisar acessibilidade de uma tela.
---

# Componentes de interface do FinTrack

## De onde vem cada peça

| Preciso de                             | Use                                                                | Onde está                                                               |
| -------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Botão, campo, rótulo, esqueleto, aviso | shadcn/ui                                                          | `src/components/ui/` (gerado pelo CLI; não edite à mão sem motivo)      |
| Mostrar um valor em reais              | `<AmountText cents={...} />`                                       | `src/components/money/amount-text.tsx`                                  |
| Digitar um valor em reais              | `<MoneyInput value onValueChange />`                               | `src/components/money/money-input.tsx`                                  |
| Tela sem dados                         | `<EmptyState icon title description action />`                     | `src/components/feedback/empty-state.tsx`                               |
| Carregando                             | `<ListSkeleton />` ou `loading.tsx` da rota (formas desfocadas)    | `src/components/feedback/list-skeleton.tsx`                             |
| Resumo do topo (destaque + números)    | `<SummaryGrid>` + `<HighlightCard>` + `<StatCard tone icon>`       | `src/components/visual/summary.tsx`                                     |
| Saldo, entradas e saídas               | `<TotalsSummary totals label balanceLabel testIdPrefix />`         | `src/features/transactions/ui/totals-summary.tsx`                       |
| Superfície de destaque livre (perfil)  | `<SoftPanel labelledBy>`                                           | `src/components/visual/summary.tsx`                                     |
| Ações secundárias da página            | `<ActionBar label>` + `<ActionBarLink href icon tone>`             | `src/components/visual/action-bar.tsx`                                  |
| Chips + ações + painel de filtros      | `<ListToolbar chipsLabel chips actions panel activeCount />`       | `src/components/visual/list-toolbar.tsx`                                |
| Novo lançamento no cabeçalho           | `<NewTransactionButton />` em `PageHeader actions`                 | `src/features/transactions/ui/new-transaction-button.tsx`               |
| Lista de coisas (linhas agrupadas)     | `<SurfaceList>` + `<SurfaceRow leading title meta trailing />`     | `src/components/visual/surface-list.tsx`                                |
| Ícone colorido de categoria/tipo       | `<IconTile tone={toneFor(id)} letter / icon />`                    | `src/components/visual/icon-tile.tsx` e `tone.ts`                       |
| Atalho ou filtro rápido                | `<ChipLink href active>`                                           | `src/components/visual/chip.tsx`                                        |
| Escolher uma entre poucas (na URL)     | `<SegmentedNav label items />` (links com `aria-current`)          | `src/components/visual/segmented-nav.tsx`                               |
| Seletor de ambiente (carteira)         | `<EnvironmentSwitcher environments current hrefFor />`             | `src/features/transactions/ui/environment-switcher.tsx`                 |
| Quem pagou (DV, NV, CP)                | `<PayerTile payer />` (texto na tinta `--chart-N-ink`)             | `src/features/transactions/ui/payer-tile.tsx`                           |
| Filtro "Pago por"                      | `<PayerChips payers current hrefFor />` no `extra` da ListToolbar  | `src/features/transactions/ui/payer-chips.tsx`                          |
| Bloco de uma página com título         | `<Section id title description>`                                   | `src/components/visual/section.tsx`                                     |
| Formulário por cima da página          | `<RouteModal title description footer>` numa rota `@modal/(.)rota` | `src/components/ui/route-modal.tsx` (exemplo: novo lançamento)          |
| Formulário de lançamento               | `EntryProvider` + `EntryForm` + `EntrySubmit`/`EntryModalActions`  | `src/features/transactions/ui/entry/`                                   |
| Erro                                   | `<ErrorState onRetry />` ou `error.tsx` da rota                    | `src/components/feedback/error-state.tsx`                               |
| Título da página                       | `<PageHeader title description actions />`                         | `src/components/layout/page-header.tsx`                                 |
| Excluir                                | Sem "tem certeza?": exclua e ofereça "Desfazer" com `undoToast`    | `src/components/feedback/undo-toast.ts` (exemplo em `dev/ui/demos.tsx`) |
| Mover o foco depois de um aviso        | `focusAfterToast(() => elemento)`                                  | `src/lib/focus.ts`                                                      |

Componente novo do shadcn: `pnpm dlx shadcn@latest add <nome>` dentro de `apps/web`.
Antes de criar um componente próprio, veja se ele já existe no catálogo: `/dev/ui`.

## Cores

- Sempre por token: `bg-background`, `text-muted-foreground`, `text-income`, `text-expense`, `text-warning`, `border`.
- Nunca cor fixa (`text-green-600`, `#1e5099`). O tema escuro depende dos tokens.
- Receita e despesa nunca só pela cor: use `AmountText`, que já traz sinal, seta e texto para leitor de tela.
- Token novo: acrescente em `:root` E em `.dark` no `globals.css`, em hexadecimal, ligue em `@theme inline` e
  ponha o par no `src/app/theme-contrast.test.ts` (texto ≥ 4,5:1; anel e gráfico ≥ 3:1).

## Como uma tela é montada (padrão Elétrico; medidas do M07.3, canvas C.2)

A referência visual é o canvas "FinTrack Visual", linha C.2. Tela nova segue esta ordem; é o que dá
ao app a mesma cara em todo lugar:

1. `PageHeader`: título grande (h1, 40 px no computador) e uma frase. Sem rótulo em caixa alta em
   cima. A ação principal à direita; nas páginas principais, `<NewTransactionButton />`.
2. **Um** resumo baixo no topo (`SummaryGrid`): um `HighlightCard` azul-claro com o número mais
   importante e `StatCard` brancos ao lado (entradas em verde, saídas em vermelho, com ícone
   redondo). Para dinheiro, `TotalsSummary`. O painel azul cheio do M07.2 saiu: ocupava meia tela.
3. A barra da lista (`ListToolbar`): chips de filtro rápido (`ChipLink`), a `ActionBar` com as
   ações secundárias e o botão Filtros, que abre o painel do formulário de filtros. No celular,
   as ações entram no painel ("Filtros e mais ações").
4. O conteúdo em blocos brancos: listas com `SurfaceList` (linhas juntas, separadas por fio,
   cada uma com um `IconTile` colorido à esquerda) e formulários em `Section`. Etiquetas de uma
   coluna (categoria, ambiente) têm **largura fixa**, para as colunas alinharem.
5. Estado vazio com `EmptyState` (ícone colorido grande e uma ação).

Estrutura, não remendo (regra do M07.3):

- Peça visual que aparece em mais de uma tela vira componente em `components/visual/`; nunca copie
  classes de uma página para outra.
- Peça que conhece o domínio (totais, lançamento) fica em `features/<nome>/ui/` e compõe as peças
  visuais. Regra de negócio não mora em componente: vai para `packages/core`.
- Formulário com partes fora do `<form>` (subtítulo e rodapé do modal) usa um provider de estado
  (exemplo: `EntryProvider`) e o botão ligado por `form=`. Refs ficam num contexto separado
  (`useEntryRefs`), com nome terminado em `Ref`, senão o compilador do React reclama.

Regras do padrão:

- **Cor por id, não por acaso**: `toneFor(categoria.id)` dá a mesma cor em toda tela. Transferência
  usa o tom 1 com o ícone de setas; "sem categoria" é neutro.
- **O nome sempre escrito ao lado da cor**: `IconTile` é decorativo (`aria-hidden`).
- **Celular primeiro; desktop em colunas** com `display: contents` (veja `transaction-list.tsx`):
  o mesmo HTML vira colunas a partir de `lg`, sem repetir texto (repetir quebra leitor de tela e
  testes).
- Títulos de seção e de dia em frase normal ("Hoje, quinta-feira, 8 de outubro"), nunca em caixa alta.
- Cantos: `rounded-3xl` no modal e nas telas de entrada, `rounded-[1.125rem]` no resumo e nas
  listas, `rounded-xl` em campos e botões, `rounded-full` em chips.
- O brilho de fundo (`app-glow`) já está na casca e nas telas de entrada; as luzes atrás do menu
  lateral são o `ShellBackdrop`. Não acrescente outros.
- **Menu lateral** (`components/layout/sidebar/`): marinho de vidro nos dois temas, só navegação
  (sem "Novo lançamento"). Recolhe pela alça na borda (`SidebarHandle`). Item novo usa
  `SidebarNavItem`; texto dentro de `<SidebarLabel>`, que recolhido vira dica e continua sendo o
  nome do link. Para esconder algo só com o menu recolhido, use a variante `collapsed:` (a partir
  de 768 px). O estado fica no cookie `fintrack-sidebar`, lido pelo servidor (`AppShell`).

## Visual "Elétrico" (ADR-008)

- **Vidro só na moldura**: `glass` no cabeçalho e na barra do celular, `glass-sidebar` no menu lateral,
  `glass-panel` no modal. Cartões, listas
  e números sempre sólidos (`bg-card`). Nunca texto pequeno direto sobre vidro em cima de conteúdo colorido.
- **Lima** (`bg-highlight text-highlight-foreground`) só como fundo com texto escuro; no escuro ela é a primária.
- **Saldo em destaque**: `HighlightCard` (tokens `hero-soft*`), com `<AmountText tone="inherit">`. O
  `bg-hero` (azul cheio) ficou só na marca e no painel das telas de entrada.
- **Hover dos botões também passa no contraste**: o `theme-contrast.test.ts` mede o hover do primário
  e do destrutivo. Botão novo com hover próprio entra lá.
- **Modal**: `RouteModal` (`<dialog>` nativo). Formulário que pode aparecer duas vezes na tela (página atrás +
  modal) recebe `idPrefix`, senão os rótulos apontam para o campo errado.

## Dinheiro e datas na tela

- Valores são `bigint` em centavos. Nunca `number`, nunca `parseFloat`.
- Formate só com `formatBRL` (`src/lib/money.ts`) e datas só com `src/lib/dates.ts` (fuso de São Paulo).

## Servidor e cliente

- Por padrão, componentes são de servidor. Só use `"use client"` quando precisar de estado, efeito, evento ou hook do navegador (`usePathname`, `useTheme`).
- Um componente de servidor não pode passar uma função (inclusive um ícone como `House`) para um componente de cliente. Passe o elemento pronto: `icon={<House aria-hidden />}`.

## Acessibilidade (obrigatório)

1. Uma página, um `<h1>` (use `PageHeader`). Seções com `<h2>`.
2. Todo campo tem `<FieldLabel htmlFor>` ligado ao `id` do campo. Erros com `<FieldError id>` + `aria-invalid` + `aria-describedby`.
3. Botão só com ícone tem `aria-label`. Ícone decorativo tem `aria-hidden`.
4. Tudo funciona só com teclado: Tab chega, Enter/Espaço aciona, o foco é visível.
5. Alvos de toque com pelo menos 40px no celular.
6. Nada de animação essencial; o `globals.css` já respeita "reduzir movimento".

## Foco (WCAG 2.2)

- **Anel visível com contraste ≥ 3:1** (critério 1.4.11): use `ring-ring` ou `ring-destructive` com cor cheia. Nunca `ring-ring/50` ou qualquer `/NN` no anel. Depois de um `shadcn add`, rode `bash scripts/corrige-aneis-de-foco.sh`.
- **Foco nunca escondido** (critério 2.4.11): o cabeçalho e a barra do celular, o botão "+" e os avisos ficam fixos na tela. O `scroll-padding` do `globals.css` já deixa a folga; não remova. Elemento fixo novo exige rever essa folga e o `e2e/foco-visivel.spec.ts`.
- **O foco nunca se perde**: quando o elemento focado some (excluir um item), leve o foco ao vizinho; se a lista ficar vazia, à mensagem de vazio (`tabIndex={-1}`). Ao desfazer, devolva o foco ao item restaurado ou ao primeiro campo do formulário. Use `focusAfterToast`, que espera o aviso aparecer.
- **Sair dos avisos pelo teclado**: o `ToastKeyboard` (`src/components/feedback/toast-keyboard.tsx`, montado no `providers.tsx`) devolve o foco com anel para onde estava, recolhe a pilha e impede o Tab de girar entre o aviso e a página. Não remova.
- **Campos com partes internas** (`type="date"`, `type="time"`): use `focus-within:` no anel, porque o botão interno do navegador não ativa o `focus-visible` do campo.
- **Formulários**: valide no envio e leve o foco ao primeiro campo com erro. O erro de um campo some assim que ele fica válido; um erro novo só aparece no próximo envio.

## Avisos (toast)

- Ação que pode ser desfeita: `undoToast(mensagem, { onUndo })`. Ele já usa 10 s e a dica "Alt+T leva aos avisos e pausa o tempo" (critério 2.2.1).
- Textos em português, inclusive os que só o leitor de tela lê (os rótulos do `Toaster` estão em `src/components/providers.tsx`).

## Antes de concluir

- `pnpm check` e `pnpm e2e` passam.
- A tela nova entrou na lista `PAGES` (app, com sessão) ou `PUBLIC_PAGES` (telas de entrada) de `e2e/helpers.ts`, usadas pelos testes de acessibilidade, de foco e de proteção.
- Conferiu no catálogo, nos dois temas, em largura de celular (390px) e de desktop, e com o modal aberto.

## Cor de tom como texto (M07.4)

`--chart-N` é cor de gráfico e de ícone (3:1). Quando a cor do tom vira **texto** que carrega
informação (as iniciais do `PayerTile`), use a tinta `--chart-N-ink`, conferida a 4,5:1 sobre o
próprio tom a 16 % no `theme-contrast.test.ts`. O `IconTile` pode usar `--chart-N` porque é
decorativo (`aria-hidden`, o nome está escrito ao lado).

## Modal sem barra de rolagem em tela baixa (M07.4)

O modal de rota mantém as medidas do canvas a partir de 840 px de altura. Abaixo disso, no
computador, a variante `compact:` (só vale dentro do `.route-modal`) aperta espaços e alturas:
`compact:gap-2`, `compact:h-10`, `compact:hidden` para textos de apoio. Bloco novo no formulário
do modal entra com as suas classes `compact:`, e o teste "o modal do novo lançamento cabe na tela"
(`e2e/resumo-e-barra.spec.ts`) confere 1280 × 720 em cada tipo de despesa. Nunca altura fixa nem
`overflow: hidden` para esconder a sobra.

A parte que rola num painel de altura automática usa `flex-auto` (base = conteúdo), nunca `flex-1`
(base 0 %): no Safari, a base 0 % faz o meio do modal sumir. O teste do modal confere
`flex-basis: auto` no estilo calculado, porque o Chromium dos testes não mostra o problema.
