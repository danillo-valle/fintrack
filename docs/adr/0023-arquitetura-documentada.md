# ADR-023: A arquitetura documentada a partir do código: o mapa do fluxo, o C4 e o site

- Status: aceita
- Data: 2026-10-28
- Módulo: M12.3b (desenho no canvas, linha K, aprovada em 28/10/2026)

## Contexto

O roteiro do M12 pedia, antes da v1.0.0: os diagramas C4, os ADRs revisados, um runbook de
incidente, um relatório com nota (estrutura de pastas, modularização, escalabilidade, segurança,
manutenção e facilidade de refatoração) e uma página interativa do fluxo do sistema (cada tela, o
que chama, quem chama, o que passa, navegador ↔ servidor), publicada de graça.

Documentação de arquitetura escrita à mão envelhece no primeiro PR que esquece dela. O FinTrack já
conferia por teste o `docs/permissoes.md`, o `docs/modelo-de-dados.md` e a Ajuda; faltava o mesmo
para o fluxo, que é o documento que mais muda (60 telas e 59 actions no M12.3a).

Decidido pelo Danillo em 28/10/2026: o mapa do fluxo **gerado do código e conferido no CI**; o C4
em **Structurizr DSL**, trocado por **Mermaid** quando o laboratório não alcançou nem o Docker Hub
nem o Maven Central (desde fevereiro de 2026 a única ferramenta do Structurizr é a imagem Docker
`structurizr/structurizr`; o CLI foi arquivado), e nada que não se teste aqui entra no kit; o
relatório **só escrito**, sem ferramenta nova no CI; o custo mensal **fora** deste módulo.

## Decisão

1. **O mapa do fluxo é gerado do código** pelo pacote `packages/flow-map` e gravado em
   `docs/arquitetura/fluxo.json` (`pnpm --filter @fintrack/flow-map generate`). Ele lê só a
   sintaxe (o compilador do TypeScript, sem o verificador de tipos nem o build) e segue cada nome
   até a declaração, por símbolo: uma tela que usa um de três componentes de um arquivo só ganha
   as actions daquele componente. Para cada tela: o endereço, o tipo (página, modal, pública ou
   moldura), a sessão que ela pede, o que carrega no servidor, as Server Actions dos formulários,
   os componentes do navegador, as chamadas ao Better Auth e os links. Para cada função do
   servidor: o que chega (o schema zod e o `formData`), a sessão, o crachá, as funções do
   `packages/db` e as tabelas delas, as filas, os serviços de fora, as regras puras, os redirects e
   o aviso ao cache. E as filas (quem põe trabalho, o horário, o trabalhador) e as rotas de API.
2. **O mapa é conferido no CI** (o `pnpm test` do pacote, no job `qualidade`): ele precisa estar
   igual ao código; toda `page.tsx` e `layout.tsx` está nele; toda Server Action exportada é
   chamada por alguma tela; todo link e todo redirect levam a uma tela que existe; toda tela de
   `(app)` e toda action pedem a sessão; e todo arquivo que faz uma chamada de rede está numa
   fronteira declarada (`SERVICES`). O `turbo.json` do pacote põe o código do app nos `inputs`,
   para o cache do Turbo não esconder um mapa velho.
3. **O C4 é texto Mermaid** em `docs/arquitetura/c4.md`: contexto, contêineres e componentes do
   app web, em `flowchart` com a notação do C4 (a sintaxe `C4Context` do Mermaid ainda embaralha
   os rótulos). O GitHub desenha o arquivo; o site desenha o mesmo texto.
4. **O site "FinTrack por dentro" no GitHub Pages**, desenhado na linha K do canvas: a visão geral
   (os números e o C4 como imagem), o mapa do fluxo (uma tela nas quatro faixas, navegador →
   servidor → banco → lá fora, e o detalhe da caixa escolhida) e o "quem usa" (de uma tabela, fila,
   serviço ou regra até as telas). Estático, montado no CI a partir do `fluxo.json` que está no Git:
   - o C4 vira SVG no build, pelo próprio Mermaid num Chromium sem rede; um diagrama com erro para
     o build;
   - nada vem de fora (fontes Geist servidas pelo site); CSP numa meta (`script-src 'self'`, sem
     nada inline), já que o Pages não deixa mandar cabeçalhos;
   - o endereço guarda a tela e a caixa (`#tela=…&no=…`), para voltar e compartilhar;
   - nenhum dado de pessoa: só nomes de telas, funções, tabelas e arquivos, que já são públicos no
     repositório.
5. **No CI**: o job `site` monta o site, roda o Playwright com o axe (claro e escuro, computador e
   celular, sem pedido para fora) e guarda o pacote; o `e2e` (exigido pelo ruleset) passa a esperar
   o `site` e a conferir o resultado dele; o job `pagina` publica com `actions/deploy-pages`, só
   num push na `main`, depois de `qualidade`, `seguranca` e `site`. As ações entram presas pelo
   commit (ADR-020).
6. **Os ADRs revisados**: cada um ganhou a seção "Revisão do M12.3b" (o que continua valendo, o
   que um ADR posterior trocou, o que ficou em aberto) e o README uma coluna com o resultado. As
   pendências espalhadas viraram uma lista só, com a prioridade, no relatório.
7. **O runbook de incidente** (`docs/operacao/incidente.md`) diz a ordem (confirmar, estabilizar,
   avisar, consertar, aprender) e aponta para as seções do runbook de operação; ao escrevê-lo, a
   revisão achou que o `fintrack-restore-test` deixava o banco decifrado num volume órfão do Docker
   (`docker rm` sem `-v`). Corrigido, com `--manter` e `--apagar` para comparar num incidente.
8. **O relatório com nota** (`docs/arquitetura/relatorio.md`): seis critérios de 0 a 10, com o
   que sustenta e o que puxa para baixo cada nota, os números medidos e como medi-los de novo.

## Consequências

- Mudou uma tela, uma action ou uma rota? `pnpm --filter @fintrack/flow-map generate` no mesmo PR;
  o teste do mapa barra quem esquecer, e o diff do `fluxo.json` mostra no PR o que mudou no fluxo.
- Arquivo novo que fala com a internet precisa entrar em `SERVICES` (o teste acusa), e com isso
  aparece no mapa e no "quem usa".
- O site sai a cada merge na `main`, sem passo manual; é preciso ligar o GitHub Pages uma vez
  (Settings › Pages › GitHub Actions) e o ambiente `github-pages` só aceita a `main`.
- O mapa é uma análise de texto, não de tipos: o que ele não vê (um link montado em tempo de
  execução, uma chamada indireta por variável) não aparece; os testes de cobertura (toda action
  usada, todo link existe) são o aviso de que algo escapou.
- Dependências novas só de desenvolvimento, no `flow-map`: o Mermaid, o Playwright e o axe (os
  mesmos do app), o esbuild (o que o tsx já usa) e a fonte Geist.

## Alternativas consideradas

- **Structurizr DSL** (a primeira escolha do Danillo): um modelo só para todas as vistas, mas a
  ferramenta só existe como imagem Docker, que o laboratório não alcança; o kit sairia sem teste.
- **Mapa escrito à mão**: mais rápido agora, mas envelhece calado a cada tela nova.
- **Ferramentas de grafo de dependências** (dependency-cruiser, madge): mostram quem importa quem,
  não "esta tela chama esta action, que pede este crachá e grava nesta tabela".
- **O verificador de tipos do TypeScript** para seguir as chamadas: mais preciso, mas lento e
  dependente do build e do cliente do Prisma gerado; a análise por sintaxe roda em 5 segundos em
  qualquer clone.
- **Um site com framework** (Next, Astro): mais uma pilha para manter para três páginas; o site é
  HTML gerado por TypeScript, um CSS e um JavaScript empacotado pelo esbuild.
- **O custo mensal** (no roteiro): fora deste módulo, por decisão do Danillo.
