# ADR-011: Coleta bancária com o Meu Pluggy

- Status: aceita
- Data: 2026-10-13
- Módulo: M09.1 (desenho no canvas, linha E)

## Contexto

Até o M08, todo lançamento era digitado. O M09 traz os dados do banco. O M09.1 cobre o primeiro
pedaço: conectar o Meu Pluggy, buscar saldos, compras e faturas, e mostrar a fatura aberta e a
fechada de cada cartão. Revisão em lote e reconciliação (M09.2), OFX (M09.3) e PDF (M09.4) vêm
depois e reaproveitam o que este ADR define.

Restrições:

- **só grátis**: o Meu Pluggy é gratuito para uso pessoal, até 5 bancos por pessoa, e só mostra
  contas no nome de quem conectou;
- **segredos**: Client ID, Client Secret e tokens nunca no Git, em log, no navegador ou no chat.
  A própria pessoa digita no app;
- **dados**: só os 4 últimos dígitos do cartão; nada real no Git, nos testes ou no laboratório.
  As respostas da Pluggy usadas em teste são sintéticas, escritas à mão;
- **o laboratório não alcança a Pluggy**: todo teste roda contra uma Pluggy de mentira;
- Prisma 7, migração só aditiva, WCAG 2.2 AA, visual igual ao canvas.

Combinado com o Danillo antes do código (11/10/2026):

- busca diária às **06:47** (America/Sao_Paulo), mais o botão "Buscar agora", sem webhooks;
- **data de corte** por conexão (padrão: dia 1º do mês anterior);
- tudo que chega do banco passa por **revisão** e fica fora das somas até lá;
- chave de cifragem em `/srv/fintrack/app.env`, com cópia no gerenciador de senhas, fora do backup;
- adicional de outra pessoa: as compras vão para o ambiente pessoal de quem usou, com a opção
  "Compras do adicional entram em [ambiente]" por cartão.

## Decisão

### Um provedor atrás de uma interface

- `packages/importers` (pacote novo) define `TransactionProvider` (`getItem`, `listAccounts`,
  `listTransactions`, `listBills`) e o `PluggyProvider`, que fala HTTP com a API. OFX e PDF
  (M09.3 e M09.4) vão implementar a mesma interface, ou uma irmã, e cair no mesmo `runSync`.
- **Dinheiro exato desde o JSON**: `parseExactJson` usa o texto original de cada número
  (`JSON.parse` com acesso à fonte, Node 24) e `moneyFromText` converte para centavos `bigint`.
  Nenhum valor do banco passa por `number`.
- Erro do provedor vira um **código** (`PROVIDER_AUTH_FAILED`, `NOT_FOUND`, `RATE_LIMITED`,
  `UNAVAILABLE`, `BAD_RESPONSE`), nunca a mensagem da API (que pode ecoar o que foi enviado).
- A chave de acesso da Pluggy (2 h) fica em memória por 110 min e é renovada uma vez num 401.

### Credenciais cifradas

- `ProviderConnection` guarda o Client ID e o Client Secret **cifrado** (AES-256-GCM, IV
  aleatório, o id da conexão como dado autenticado). Formato:
  `[versão da chave][IV 12][tag 16][cifrado]`.
- `CONNECTION_SECRET_KEYS="2:<base64>,1:<base64>"`: a primeira cifra, todas decifram. Trocar a
  chave é acrescentar uma versão nova na frente; sem chave, as telas explicam que o servidor não
  está pronto. Perder a chave é só digitar o Client Secret de novo.
- "Testar e continuar" confere as credenciais e cada Item ID na Pluggy **antes** de gravar.
  Credencial errada não chega ao banco. Mexer em credenciais e ligações pede prova de
  identidade dos últimos 10 minutos (como o CSV do M07).
- Uma conexão por pessoa (`unique(userId, provider)`), até 5 Item IDs. Só quem conectou vê e
  mexe na conexão (`authorizeConnectionOwner`).

### Sincronização na fila (pg-boss)

- **pg-boss 12** no mesmo Postgres (schema `pgboss`), sem Redis e sem serviço novo. O worker
  sobe dentro do próprio servidor do app (`instrumentation.ts`); `SYNC_WORKER=off` desliga.
- Fila `bank-sync` com `policy: stately` e `singletonKey = connectionId`: uma busca por conexão
  por vez, as outras esperam ou são descartadas. `bank-sync-daily` (cron `47 6 * * *`) enfileira
  todas as conexões prontas.
- `runSync` registra cada execução em `SyncRun` (quem pediu, novos, atualizados, sem mudança,
  fora do período, erro em código).
- **Idempotência**: chave única `(accountId, source, externalId)` e `createMany` com
  `skipDuplicates`. A busca seguinte relê os últimos 40 dias (`IMPORT_OVERLAP_DAYS`), nunca
  antes da data de corte. Recebido que o banco corrigiu é atualizado; o que a pessoa já
  conferiu (`CONFIRMED`) **nunca** muda.

### Recebidos fora das somas

- Tudo entra como `PENDING` com `source = OPEN_FINANCE`. Recebido fica fora da lista padrão, dos
  totais e das duas consultas do painel (`status <> 'PENDING'`). Aparece em
  `/lancamentos?situacao=recebidos`, no aviso do Início e na página do cartão.
- A cascata de categorização roda na importação com o **escopo de quem vai ver** o lançamento.
  O histórico ignora recebidos categorizados por regra ou histórico (senão uma sugestão errada
  viraria exemplo de si mesma).
- "Categoria em um clique" (`setCategoryAction`) grava `MANUAL`, vira exemplo de treino e, se
  pedido, cria a regra. Funciona antes do JavaScript (`<details>` e `<form>` com a Server Action).

### Faturas

- A Pluggy só entrega fatura **fechada** (`Bill`). A **aberta** é calculada: as compras desde o
  fechamento anterior (`openStatementWindow`), com as datas do banco valendo mais que o ciclo
  cadastrado.
- A fechada é gravada com encargos (`StatementCharge`: IOF, juros, multa, outros) e pagamentos
  (`StatementPayment`; o pagamento que aparece na Bill N+1 quita a Bill N). A tela confere ao
  centavo: compras + encargos = total da Bill (`settlementCheck`), e mostra a diferença se não
  bater.
- O pagamento de fatura dentro do cartão não vira lançamento: a perna vem da conta corrente.

### Adicional de outra pessoa

- O banco manda as compras do adicional na conexão do titular. Pelo final do cartão
  (`lastFourOf`), `importWalletFor` decide o ambiente: a escolha do cartão (`importWalletId`)
  vence; senão, adicional de outra pessoa vai para o ambiente pessoal dela; senão, o ambiente
  da conta. O titular vê a fatura inteira na página do cartão; quem usou o adicional vê as
  próprias compras no ambiente dela.
- Só aceita um ambiente de que a dona do adicional participa (a Casa, o pessoal dela).
- A confirmar na primeira conexão real: se o Itaú manda o final do adicional em cada compra.
  Se não mandar, tudo cai na conta do titular e a escolha vira manual (M09.2).

### Testes sem a Pluggy de verdade

- `@fintrack/importers/testing` traz o **banco sintético** (Banco Aurora e Banco Exemplo,
  finais 0001 a 0003, datas relativas a hoje) e a **Pluggy de mentira** (`createFakePluggy`,
  com páginas, falhas e o mesmo formato da API). A fixture gravada em
  `packages/importers/fixtures/pluggy/` é conferida por teste contra o gerador.
- Desenvolvimento, CI e E2E apontam para a de mentira (`PLUGGY_API_URL=http://127.0.0.1:8787`,
  `pnpm pluggy:fake`). Só a produção usa `https://api.pluggy.ai`.

## Consequências

- Positivas: o painel continua confiável (nada do banco soma sem revisão); a importação é
  repetível sem duplicar; o formato de provedor e a fila servem para OFX, PDF e a IA do M10; a
  chave pode ser trocada sem parar o app.
- Negativas: o worker roda no mesmo processo do site (uma busca pesada divide CPU com as
  páginas; aceitável com uma pessoa por conexão e 5 bancos). O Meu Pluggy atualiza a cada 24 h:
  "Buscar agora" lê o que ele já tem, não pede dados novos ao banco (a tela diz isso).
- Riscos: mudança no formato da API da Pluggy (o adaptador valida e falha com
  `BAD_RESPONSE`, sem gravar nada); perda da chave (digitar o Client Secret de novo).

## Alternativas consideradas

- **Webhooks da Pluggy**: exigem URL pública recebendo chamadas e não trazem ganho com
  atualização diária. Descartado por agora.
- **BullMQ + Redis**: mais um serviço para operar e fazer backup. O pg-boss usa o Postgres que
  já existe.
- **Recebido somando direto no painel**: mais rápido, mas compras duplicadas ou erradas iriam
  para o orçamento sem ninguém ver. A revisão vem primeiro.
- **Guardar o Client Secret em texto**: um backup vazado entregaria o acesso ao banco.
