# Relatório de arquitetura do FinTrack (M12.3b, v0.12.5)

Uma avaliação franca do código como está em 28/10/2026, antes da v1.0.0: seis critérios, cada um
com nota de 0 a 10, o que sustenta a nota, o que a puxa para baixo e o que fazer. Notas de um
revisor só, para servirem de comparação na próxima revisão, não de selo.

**Como foi avaliado.** Leitura dos 22 ADRs (cada um ganhou a "Revisão do M12.3b"), do código e dos
números abaixo, medidos no commit `2b5ea40` com comandos que qualquer pessoa repete:

| Medida                                       | Valor                                                                                                               | Como medir                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Telas (página e modal), ações, carregamentos | 49 páginas (9 públicas), 11 modais, 59 Server Actions, 40 carregamentos                                             | `docs/arquitetura/fluxo.json` (o mapa do fluxo) |
| Filas, tabelas, serviços de fora             | 6 filas, 42 tabelas, 6 serviços                                                                                     | idem                                            |
| Testes declarados                            | core 313, db 361, importers 60, web 249, flow-map 21, Python 87, E2E 162                                            | `it(`/`test(`/`def test_` por pasta             |
| Testes rodados                               | 452 de integração (Postgres), 573 E2E (dois aparelhos)                                                              | `pnpm test:integration`, `pnpm e2e:producao`    |
| Imports entre features                       | 4 pares (bank → auth, bank → categories, budget → transactions, transactions → auth)                                | `grep "@/features/"` dentro de cada feature     |
| Maiores arquivos de código                   | `packages/db/src/bot.ts` 1.581 linhas; `features/budget/server/queries.ts` 1.075; `packages/db/src/review.ts` 1.067 | `wc -l`                                         |

| Critério                  | Nota    |
| ------------------------- | ------- |
| Estrutura de pastas       | 9       |
| Modularização             | 8       |
| Escalabilidade            | 6       |
| Segurança                 | 9       |
| Manutenção                | 8       |
| Facilidade de refatoração | 8       |
| **Média**                 | **8,0** |

## 1. Estrutura de pastas: 9

**O que sustenta.** Uma regra só, e ela se repete: `apps/web/src/features/<nome>/` com `server/`
(o que só roda no servidor), `ui/` (componentes) e `schemas.ts` (o que chega). Rotas em `app/`,
peças visuais compartilhadas em `components/{layout,money,feedback,visual}`, utilitários em `lib/`.
Os pacotes têm uma responsabilidade cada (`core` regras puras, `db` banco e crachás, `importers`
dados do banco, `config` lint e TypeScript, `flow-map` o mapa). `samples/` é a única pasta com
arquivos de banco, e só sintéticos. Um recém-chegado acha uma tela pelo endereço e o servidor dela
pelo nome da feature.

**O que puxa para baixo.**

- `features/bank` cresceu para 40 arquivos e 5,3 mil linhas e hoje guarda quatro assuntos (a
  conexão do Meu Pluggy, a revisão, o OFX e o PDF). O nome já não diz o que tem dentro.
- `lib/` tem 49 arquivos de natureza diferente (sessão, filas, canais do bot, log, CSP, dinheiro);
  só parte está em subpastas (`lib/auth`, `lib/whatsapp`, `lib/telegram`, `lib/ml`).

**Recomendação.** Dividir `features/bank` em `connections`, `review` e `imports` quando a próxima
mudança tocar nelas (é mover arquivos e trocar imports: o mapa do fluxo mostra quem chama o quê).
Agrupar `lib/` por assunto (`lib/http` para CSP e cabeçalhos, `lib/jobs` como pasta).

## 2. Modularização: 8

**O que sustenta.**

- **Direção das dependências limpa**: `core` não depende de ninguém; `importers` só de `core`;
  `db` de `core` e `importers`; o app de todos. Nenhum pacote importa o app.
- **Fronteiras com trava**: o ESLint só deixa o banco em `features/*/server` e `lib`; o crachá
  tipado faz esquecer a checagem de acesso virar erro de compilação (ADR-006); o mapa do fluxo
  confere que toda tela e toda action pedem a sessão.
- **Pouco acoplamento entre features**: 4 pares de imports, todos de leitura (o orçamento lê os
  filtros dos lançamentos, a revisão usa a categoria em um clique).
- **Interfaces onde há troca**: `TransactionProvider` (Pluggy, OFX, PDF), `CategorySuggester`
  (as 5 camadas da cascata), o canal do bot (WhatsApp e Telegram).

**O que puxa para baixo.**

- **Arquivos grandes demais**: `packages/db/src/bot.ts` (1.581 linhas: vínculo, rascunho,
  confirmação, contagem de respostas e limpeza), `review.ts` (1.067) e
  `features/budget/server/queries.ts` (1.075). Cada um é um módulo inteiro dentro de um arquivo.
- **Uma regra escrita duas vezes**: o "Pago por" vive no `core` (TypeScript) e no SQL do painel;
  um teste de integração compara linha a linha, mas a duplicação continua sendo um custo.
- `db` depende de `importers` porque a busca do banco (`runSync`) chama o provedor de dentro da
  transação de gravação: persistência e integração no mesmo módulo.

**Recomendação.** Quebrar `bot.ts` por assunto (`bot/link.ts`, `bot/drafts.ts`, `bot/quota.ts`),
mantendo a mesma API exportada pelo `index.ts`; o mesmo para `review.ts`. A regra "Pago por" pode
virar uma view do Postgres usada pelos dois lados, se a duplicação incomodar de novo.

## 3. Escalabilidade: 6

A nota mede o sistema contra crescer, não contra o objetivo: o FinTrack foi desenhado para uma casa
num servidor de casa (ADR-005), e para isso está folgado.

**O que sustenta.**

- **As consultas crescem bem**: lista por cursor (keyset), somas agrupadas no banco com índice
  `(walletId, occurredOn)`, painel abaixo de 0,3 s com 24 meses (ADR-010), cache das somas por lar.
- **Trabalho pesado fora do pedido**: busca do banco, treino do classificador e IA local em filas
  (pg-boss), idempotentes e com uma execução por conexão por vez.
- **Sair de casa está escrito**: restaurar um backup numa VPS segue o runbook, sem mudar código.

**O que puxa para baixo.**

- **Uma máquina só**, sem redundância: luz ou internet de casa derrubam o app.
- **Os trabalhadores das filas rodam no processo do site**: uma busca pesada divide CPU com as
  páginas (ADR-011). Mais pessoas, mais buscas no mesmo processo.
- **Um Postgres só**, sem réplica, e a invalidação do cache é por lar inteiro (qualquer mudança
  recalcula o painel de todos do lar).
- **Uma pessoa, um lar** (`ALREADY_IN_HOUSEHOLD`): o banco aceita vários, o app ainda não.

**Recomendação.** O primeiro passo, quando precisar, é tirar os trabalhadores do processo do site
(o mesmo código num contêiner `worker`, com `SYNC_WORKER=off` no `web`); o segundo, uma VPS com o
backup restaurado. Nenhum dos dois pede mudança de modelo.

## 4. Segurança: 9

**O que sustenta.**

- **O OWASP Top 10:2025 item por item**, com prova para cada item e as exceções escritas (ADR-020).
- **O CI barra**: ZAP passivo contra a imagem, OSV nos dois lockfiles, CodeQL, gitleaks e as ações
  presas pelo commit.
- **Acesso**: crachá tipado, 404 para o que é de outra pessoa, 2FA obrigatório, reautenticação
  para o que tira dado (CSV) ou mexe em credencial, auditoria só de acréscimo.
- **Dados**: segredos só no servidor e cifrados (AES-256-GCM, age), número do bot como HMAC, texto
  da mensagem cifrado e apagado ao ler, só os 4 últimos dígitos do cartão, descrição nunca em log.
- **Achado e corrigido nesta revisão**: o teste mensal de restauração deixava o banco decifrado
  num volume órfão do Docker (`docker rm` sem `-v`). Agora o volume sai junto.

**O que puxa para baixo.**

- As 6 pendências do documento do OWASP: sem alerta automático para eventos de segurança, imagem
  sem atestado de origem, imagens-base sem digest, sem e-mail de "novo acesso", o limite do código
  de vínculo por remetente e o ZAP só passivo.
- Os formulários de entrada ainda enviam pelo cliente do Better Auth no navegador (ADR-003); o
  RLS do Postgres não foi adotado (ADR-006, revisão).

**Recomendação.** Antes da v1.0.0: a varredura ativa do ZAP numa cópia local e o alerta de eventos
de segurança (os dois itens de maior risco). Depois, o atestado das imagens com o Renovate.

## 5. Manutenção: 8

**O que sustenta.**

- **Mais de mil testes** em quatro níveis: regras puras (com testes de propriedade), integração
  contra o Postgres (452), ponta a ponta contra o build de produção (573, com axe em todas as
  telas) e o pytest do serviço Python.
- **Documentação que não envelhece calada**: `docs/permissoes.md`, `docs/modelo-de-dados.md`, a
  Ajuda e agora o mapa do fluxo são conferidos por teste; o OWASP muda no mesmo PR que a proteção.
- **Decisões escritas**: 23 ADRs, revisados neste módulo, e as skills do repositório que explicam
  como fazer cada coisa.
- **Operação documentada**: runbook por peça e, agora, o de incidente.

**O que puxa para baixo.**

- **Uma pessoa só** conhece o sistema inteiro; o processo de módulo (manual, kit, check) é pesado
  e depende dela.
- **A suíte inteira leva uma hora** no servidor de casa (N150); no CI, 10 minutos em 3 partes.
- **Versões presas por motivo**: Prisma 7 (o Better Auth ainda pede), o cache do Turbopack
  desligado no `pnpm dev` (laço de recarga do Next). Cada uma é uma conta a pagar.
- O Dependabot não olha tudo (imagens-base com `ARG`, o modelo do LLM).

**Recomendação.** Dependabot × Renovate (resolve as imagens e dá o digest); um painel de
pendências com dono e data (hoje elas estão espalhadas nos ADRs, consolidadas no README dos ADRs).

## 6. Facilidade de refatoração: 8

**O que sustenta.**

- **TypeScript estrito** (`noUncheckedIndexedAccess`), dinheiro em `bigint` com a trava do ESLint,
  e os crachás no tipo: a maior parte dos erros de uma mudança aparece no `pnpm typecheck`.
- **Regras puras e testadas** no `core`: dá para mexer no "como" sem medo do "o quê".
- **O mapa do fluxo** mostra, antes de mexer, quem chama uma função e que telas usam uma tabela, e o
  teste dele acusa link para tela que não existe e action que nenhuma tela chama.
- **Migrações só aditivas** (expandir, migrar, contrair) e o deploy com volta automática.

**O que puxa para baixo.**

- Os arquivos grandes (seção 2) são os mais difíceis de mudar sem efeito colateral.
- Regra em dois lugares (TypeScript e SQL; o gatilho do banco e o `allowedMethods`), sempre com um
  teste de concordância, que é a única coisa entre eles e a divergência.
- Os E2E seguem a tela de perto (textos e papéis): mudar um rótulo pede mudar o teste.

**Recomendação.** Quebrar os três arquivos grandes antes da próxima feature que tocar neles, um PR
por arquivo, sem mudar comportamento (o mapa do fluxo e os testes de integração provam que nada
mudou).

## Pendências consolidadas

As pendências dos ADRs e do OWASP, numa lista só, por prioridade. O README dos ADRs tem a mesma
lista. As notas acima são as de 28/10; o que foi feito depois fica marcado aqui, sem mudar a nota.

**Depois da avaliação (M12.4a, 29/10).** As duas de prioridade alta foram feitas antes da v1.0.0
(ADR-024): o `fintrack-alerta` avisa pelo Healthchecks quando um evento de segurança passa do
limite, e a varredura ativa do ZAP roda numa cópia local descartável (`scripts/zap/copia-local.sh`),
com o resultado no documento do OWASP. A varredura achou um defeito, corrigido no mesmo módulo: um
caractere nulo na busca derrubava a lista (erro 500); na revisão de todas as entradas de texto,
apareceu também um invisível que escondia um cartão do bot. Todo texto de fora passou a ser limpo
na entrada (`cleanText`, `textField()`), e a cópia local passou a contar os erros do app durante o
ataque.

| #   | Pendência                                                                  | Onde             | Prioridade     |
| --- | -------------------------------------------------------------------------- | ---------------- | -------------- |
| 1   | Varredura ativa do ZAP numa cópia local, antes da v1.0.0                   | OWASP 6          | Feita (M12.4a) |
| 2   | Alerta automático para eventos de segurança (`auth.failed`, limite)        | OWASP 1          | Feita (M12.4a) |
| 3   | Formulários de entrada como Server Actions (sem o cliente do Better Auth)  | ADR-003          | Média          |
| 4   | Quebrar `packages/db/src/bot.ts`, `review.ts` e `budget/server/queries.ts` | Relatório 2      | Média          |
| 5   | Recorrências lançadas pela fila todo dia 1º (hoje é um botão)              | ADR-007          | Média          |
| 6   | Dependabot × Renovate, com digest nas imagens-base                         | ADR-016, OWASP 3 | Média          |
| 7   | Atestado de origem das imagens do GHCR                                     | OWASP 2          | Média          |
| 8   | Busca por texto sem acento (`unaccent`)                                    | ADR-007          | Baixa          |
| 9   | Editar ou excluir uma compra parcelada inteira                             | ADR-009          | Baixa          |
| 10  | O React #418 depois de um envio antes do React (conferir no Next 16.4.3)   | ADR-010          | Baixa          |
| 11  | Perfil do PDF do banco do Danillo                                          | ADR-014          | Baixa          |
| 12  | "Ambiente" × "Carteira": um nome só na tela (decisão do Danillo)           | ADR-004          | Baixa          |
| 13  | Tirar o `turbopackFileSystemCacheForDev: false` quando o Next corrigir     | ADR-021          | Baixa          |
| 14  | E-mail de "novo acesso" em aparelho novo                                   | OWASP 4          | Baixa          |
| 15  | Limite do código de vínculo por remetente                                  | OWASP 5          | Baixa          |
| 16  | A exceção do OSV para o `deepmerge` (rever até 31/01/2027)                 | ADR-020          | Data           |
