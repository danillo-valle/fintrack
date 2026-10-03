# ADR-002: Design system com shadcn/ui, tokens OKLCH e dinheiro em centavos

- **Status:** aceita
- **Data:** 2026-10-02
- **Módulo:** M02

## Contexto

O FinTrack precisa de uma interface consistente em celular e desktop, nos temas claro e
escuro, acessível (WCAG 2.2 AA) e com componentes específicos para dinheiro. É um projeto
de uma pessoa só, então o custo de manter componentes precisa ser baixo.

## Decisão

1. **shadcn/ui com base Radix e estilo Nova.** Os componentes são copiados para o
   repositório (`src/components/ui`) e passam a ser código nosso. A acessibilidade de
   teclado e leitor de tela vem das primitivas do Radix.
2. **Cores como tokens em OKLCH** no `globals.css`, com tokens semânticos próprios:
   `income`, `expense` e `warning`. Contraste mínimo de 4,5:1 em todas as combinações de texto.
3. **Dinheiro na interface como `bigint` em centavos**, formatado com `Intl` a partir de
   texto decimal. Nas bordas (formulário, API, banco) o valor viaja como texto `"1234.56"`,
   compatível com o `Prisma.Decimal` do M04.
4. **Entrada de valor no estilo maquininha** (dígitos entram pela direita), tratada pelo
   evento `beforeinput` para não depender da posição do cursor.
5. **Qualidade de interface verificada por máquina:** axe em todas as páginas nos dois
   temas (E2E no CI) e Lighthouse de acessibilidade ≥ 95.

## Alternativas consideradas

- **Biblioteca de componentes instalada (MUI, Chakra):** mais pronta, mas o visual e a
  marcação ficam presos à biblioteca e o pacote é maior.
- **Componentes escritos do zero:** controle total, mas refazer foco, teclado e ARIA de
  menus e diálogos é caro e fácil de errar.
- **Dinheiro como `number` em reais:** erros de arredondamento (0,1 + 0,2) e perda de
  precisão acima de 2^53 centavos.
- **Máscara de entrada com biblioteca:** resolve a formatação, mas não o cursor no celular.

## Consequências

- Atualizar componentes do shadcn é uma ação explícita (`shadcn add --overwrite`), revisada por diff.
- Toda cor nova exige par claro/escuro e conferência de contraste.
- O catálogo `/dev/ui` precisa acompanhar cada componente novo.

## Adendo: decisões de foco da revisão 2 (registrado no M04)

Decisões tomadas na revisão 2 do M02 e que faltavam neste registro:

1. **Anel de foco com a cor cheia.** O shadcn gera `ring-ring/50` (cerca de 2,4:1 no tema
   claro); o `scripts/corrige-aneis-de-foco.sh` troca por `ring-ring` (3:1 ou mais, WCAG 1.4.11)
   e roda depois de todo `shadcn add`. O `e2e/foco-visivel.spec.ts` exige o anel do tema
   (`box-shadow`), não só "algum contorno".
2. **Nada fixo cobre o elemento focado** (WCAG 2.4.11): o `globals.css` define
   `scroll-padding` para a barra inferior do celular, o botão "Novo lançamento" e a pilha de
   avisos, em cada tamanho de tela.
3. **O foco nunca se perde** depois de uma ação: `lib/focus.ts` (`focusAfterToast`) leva o
   foco ao lugar certo depois que o aviso aparece, respeitando o `scroll-padding`.
4. **Avisos com "Desfazer" duram 10 s** (`undoToast`), e `Alt+T` leva o foco aos avisos e pausa
   o tempo (`ToastKeyboard`); o próximo `Tab` volta à página pulando o aviso.
