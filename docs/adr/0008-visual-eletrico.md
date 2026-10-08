# ADR-008: Visual "Elétrico" com vidro só na moldura

- Status: aceita
- Data: 2026-10-08
- Módulo: M07.1 (patch de visual entre o M07 e o M08)

## Contexto

O visual do M02 (azul-tinta, superfícies cinza) ficou correto, mas apagado. O pedido foi um app mais
moderno, com cores vivas, efeito de vidro (glassmorphism), modais na web, placeholders com desfoque e
letras modernas. Três direções foram desenhadas e comparadas (A "Neon Aurora", vidro em tudo sobre fundo
escuro; B "Tropical", claro com ilhas de vidro; C "Elétrico", vidro só na moldura). A escolhida foi a C.

Três restrições pesaram na escolha:

1. **Contraste (WCAG 2.2 AA, verificado por máquina).** Texto sobre vidro muda de contraste conforme o que
   passa por baixo. O axe não consegue medir isso com segurança (marca como "revisar").
2. **Celular barato.** `backdrop-filter` custa processamento; quanto mais área de vidro, pior a rolagem.
3. **Evolução por acréscimo (ADR-004).** O módulo M08 (dashboards) vem a seguir; a troca precisa caber no
   tema e na casca, sem reescrever telas.

## Decisão

- **Paleta "Elétrico"** em hexadecimal no `globals.css` (antes OKLCH), para que o teste
  `src/app/theme-contrast.test.ts` confira cada par de texto e fundo (≥ 4,5:1) e o anel de foco e as cores
  de gráfico (≥ 3:1) nos dois temas:
  - claro: fundo `#f3f5fc`, cartão branco, texto `#0e1325`, primária **azul elétrico** `#2f5bff`;
  - escuro: fundo `#0a0d18`, cartão `#141a2c`, texto `#eef2ff`, primária **lima** `#c6ff3d` com texto escuro;
  - lima (`--highlight`) só como fundo com texto escuro, nunca como texto no tema claro (o teste confere);
  - `--hero` (azul) é o cartão do saldo; entrada `#0f7a3d`/`#4be38a`, saída `#d0193a`/`#ff7088`.
- **Vidro só na moldura**: cabeçalho e barra inferior do celular (utilitário `glass`) e o painel do modal
  (`glass-panel`, 90 % opaco). Menu lateral, cartões, listas e números ficam sólidos (`bg-card`).
  Sem suporte a `backdrop-filter`, ou com `prefers-reduced-transparency: reduce`, o vidro vira sólido.
- **Modal de rota** para o novo lançamento: rota paralela `@modal` + rota interceptada
  `(.)lancamentos/novo`. Dentro do app, o formulário abre por cima da página (painel que sobe no celular,
  modal centralizado a partir de 768 px); recarregar ou abrir o link direto mostra a página inteira.
  `<dialog>` nativo com `showModal()`: foco preso, página atrás inerte e Esc sem biblioteca. Fechar volta
  no histórico. Os campos do modal usam ids com prefixo (`modal-`) para não repetir os da página atrás.
  Sem rota "pega-tudo" no `@modal`: ela faria endereços inexistentes responderem 200 em vez de 404.
- **Placeholders com desfoque** (`blur-placeholder`): o `Skeleton` vira uma forma desfocada e o
  `ListSkeleton` mostra o aviso "Carregando…" visível (e lido pelo leitor de tela).
- **Letras**: Geist continua (já era a do app); valores em **Geist Mono** (`AmountText`), para alinhar
  colunas de dinheiro.

## Consequências

- O visual muda em todas as telas sem mexer na lógica de nenhuma; o M08 já nasce com as cores de gráfico.
- Toda cor nova entra em `:root` e `.dark` em hexadecimal e no `theme-contrast.test.ts`.
- Elemento fixo novo com vidro exige rever o `scroll-padding` e o `e2e/foco-visivel.spec.ts` (ADR-002).
- Alternativas descartadas: A (contraste instável sobre luzes coloridas; muito vidro para celular barato) e
  B (pílulas e teclado próprio mudariam o comportamento das telas, não só o visual).
