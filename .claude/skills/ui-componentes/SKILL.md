---
name: ui-componentes
description: Como construir telas e componentes no FinTrack com shadcn/ui, Tailwind e os tokens do tema. Use ao criar ou alterar qualquer arquivo .tsx em apps/web/src, ao adicionar um componente do shadcn, ou ao revisar acessibilidade de uma tela.
---

# Componentes de interface do FinTrack

## De onde vem cada peça

| Preciso de                             | Use                                                             | Onde está                                                               |
| -------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Botão, campo, rótulo, esqueleto, aviso | shadcn/ui                                                       | `src/components/ui/` (gerado pelo CLI; não edite à mão sem motivo)      |
| Mostrar um valor em reais              | `<AmountText cents={...} />`                                    | `src/components/money/amount-text.tsx`                                  |
| Digitar um valor em reais              | `<MoneyInput value onValueChange />`                            | `src/components/money/money-input.tsx`                                  |
| Tela sem dados                         | `<EmptyState icon title description action />`                  | `src/components/feedback/empty-state.tsx`                               |
| Carregando                             | `<ListSkeleton />` ou `loading.tsx` da rota                     | `src/components/feedback/list-skeleton.tsx`                             |
| Erro                                   | `<ErrorState onRetry />` ou `error.tsx` da rota                 | `src/components/feedback/error-state.tsx`                               |
| Título da página                       | `<PageHeader title description actions />`                      | `src/components/layout/page-header.tsx`                                 |
| Excluir                                | Sem "tem certeza?": exclua e ofereça "Desfazer" com `undoToast` | `src/components/feedback/undo-toast.ts` (exemplo em `dev/ui/demos.tsx`) |
| Mover o foco depois de um aviso        | `focusAfterToast(() => elemento)`                               | `src/lib/focus.ts`                                                      |

Componente novo do shadcn: `pnpm dlx shadcn@latest add <nome>` dentro de `apps/web`.
Antes de criar um componente próprio, veja se ele já existe no catálogo: `/dev/ui`.

## Cores

- Sempre por token: `bg-background`, `text-muted-foreground`, `text-income`, `text-expense`, `text-warning`, `border`.
- Nunca cor fixa (`text-green-600`, `#1e5099`). O tema escuro depende dos tokens.
- Receita e despesa nunca só pela cor: use `AmountText`, que já traz sinal, seta e texto para leitor de tela.
- Token novo: acrescente em `:root` E em `.dark` no `globals.css`, confira contraste ≥ 4,5:1 e ligue em `@theme inline`.

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
- Conferiu no catálogo, nos dois temas, em largura de celular (390px) e de desktop.
