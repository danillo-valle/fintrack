---
name: ui-componentes
description: Como construir telas e componentes no FinTrack com shadcn/ui, Tailwind e os tokens do tema. Use ao criar ou alterar qualquer arquivo .tsx em apps/web/src, ao adicionar um componente do shadcn, ou ao revisar acessibilidade de uma tela.
---

# Componentes de interface do FinTrack

## De onde vem cada peça

| Preciso de                             | Use                                                                    | Onde está                                                               |
| -------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Botão, campo, rótulo, esqueleto, aviso | shadcn/ui                                                              | `src/components/ui/` (gerado pelo CLI; não edite à mão sem motivo)      |
| Mostrar um valor em reais              | `<AmountText cents={...} />`                                           | `src/components/money/amount-text.tsx`                                  |
| Digitar um valor em reais              | `<MoneyInput value onValueChange />`                                   | `src/components/money/money-input.tsx`                                  |
| Tela sem dados                         | `<EmptyState icon title description action />`                         | `src/components/feedback/empty-state.tsx`                               |
| Carregando                             | `<ListSkeleton />` ou `loading.tsx` da rota (formas desfocadas)        | `src/components/feedback/list-skeleton.tsx`                             |
| Destaque da página (um só)             | `<HeroPanel>` + `<HeroStat>` (valores com `AmountText tone="inherit"`) | `src/components/visual/hero-panel.tsx`                                  |
| Lista de coisas (linhas agrupadas)     | `<SurfaceList>` + `<SurfaceRow leading title meta trailing />`         | `src/components/visual/surface-list.tsx`                                |
| Ícone colorido de categoria/tipo       | `<IconTile tone={toneFor(id)} letter / icon />`                        | `src/components/visual/icon-tile.tsx` e `tone.ts`                       |
| Atalho ou filtro rápido                | `<ChipLink href active>`                                               | `src/components/visual/chip.tsx`                                        |
| Bloco de uma página com título         | `<Section id title description>`                                       | `src/components/visual/section.tsx`                                     |
| Formulário por cima da página          | `<RouteModal title>` numa rota interceptada `@modal/(.)rota`           | `src/components/ui/route-modal.tsx` (exemplo: novo lançamento)          |
| Erro                                   | `<ErrorState onRetry />` ou `error.tsx` da rota                        | `src/components/feedback/error-state.tsx`                               |
| Título da página                       | `<PageHeader title description actions />`                             | `src/components/layout/page-header.tsx`                                 |
| Excluir                                | Sem "tem certeza?": exclua e ofereça "Desfazer" com `undoToast`        | `src/components/feedback/undo-toast.ts` (exemplo em `dev/ui/demos.tsx`) |
| Mover o foco depois de um aviso        | `focusAfterToast(() => elemento)`                                      | `src/lib/focus.ts`                                                      |

Componente novo do shadcn: `pnpm dlx shadcn@latest add <nome>` dentro de `apps/web`.
Antes de criar um componente próprio, veja se ele já existe no catálogo: `/dev/ui`.

## Cores

- Sempre por token: `bg-background`, `text-muted-foreground`, `text-income`, `text-expense`, `text-warning`, `border`.
- Nunca cor fixa (`text-green-600`, `#1e5099`). O tema escuro depende dos tokens.
- Receita e despesa nunca só pela cor: use `AmountText`, que já traz sinal, seta e texto para leitor de tela.
- Token novo: acrescente em `:root` E em `.dark` no `globals.css`, em hexadecimal, ligue em `@theme inline` e
  ponha o par no `src/app/theme-contrast.test.ts` (texto ≥ 4,5:1; anel e gráfico ≥ 3:1).

## Como uma tela é montada (padrão Elétrico, M07.2)

Toda tela nova segue esta ordem; é o que dá ao app a mesma cara em todo lugar:

1. `PageHeader`: título grande (h1) e uma frase. Sem rótulo em caixa alta em cima.
2. **Um** `HeroPanel` no topo, com o número ou a coisa mais importante da página (o saldo, o
   perfil, o resumo). Nunca dois por página: o destaque é o que torna a página memorável.
3. Atalhos e filtros rápidos como `ChipLink` (no celular, uma linha que rola para o lado).
4. O conteúdo em blocos brancos: listas com `SurfaceList` (linhas juntas, separadas por fio,
   cada uma com um `IconTile` colorido à esquerda) e formulários em `Section`.
5. Estado vazio com `EmptyState` (ícone colorido grande e uma ação).

Regras do padrão:

- **Cor por id, não por acaso**: `toneFor(categoria.id)` dá a mesma cor em toda tela. Transferência
  usa o tom 1 com o ícone de setas; "sem categoria" é neutro.
- **O nome sempre escrito ao lado da cor**: `IconTile` é decorativo (`aria-hidden`).
- **Celular primeiro; desktop em colunas** com `display: contents` (veja `transaction-list.tsx`):
  o mesmo HTML vira colunas a partir de `lg`, sem repetir texto (repetir quebra leitor de tela e
  testes).
- Títulos de seção e de dia em frase normal ("Hoje, quinta-feira, 8 de outubro"), nunca em caixa alta.
- Cantos: `rounded-3xl` no painel e nas telas de entrada, `rounded-2xl` em blocos e listas,
  `rounded-full` em chips. Sombra só no painel e no cartão de entrada.
- O brilho de fundo (`app-glow`) já está na casca e nas telas de entrada; não acrescente outros.
- **Menu lateral recolhível**: item novo no menu lateral usa `group/item relative` e o texto dentro de
  `<SidebarLabel>`. Recolhido, o texto vira dica (mouse e Tab) e continua sendo o nome do link para o
  leitor de tela. Para esconder algo só com o menu recolhido, use a variante `collapsed:` (vale a partir
  de 768 px). O estado fica no cookie `fintrack-sidebar`, lido pelo servidor (`AppShell`).

## Visual "Elétrico" (ADR-008)

- **Vidro só na moldura**: `glass` no cabeçalho e na barra do celular, `glass-sidebar` no menu lateral,
  `glass-panel` no modal. Cartões, listas
  e números sempre sólidos (`bg-card`). Nunca texto pequeno direto sobre vidro em cima de conteúdo colorido.
- **Lima** (`bg-highlight text-highlight-foreground`) só como fundo com texto escuro; no escuro ela é a primária.
- **Saldo em destaque**: `bg-hero text-hero-foreground` com `<AmountText tone="inherit">` (a cor de
  receita/despesa não passa no contraste sobre o azul; o sinal e a seta continuam).
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
