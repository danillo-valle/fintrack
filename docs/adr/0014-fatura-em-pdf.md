# ADR-014: Fatura do cartão em PDF e o serviço Python

- Status: aceita
- Data: 2026-10-15
- Módulo: M09.4 (desenho no canvas, linha E.4)

## Contexto

O OFX (ADR-013) cobre o extrato da conta e, em alguns bancos, a fatura do cartão. Mas muito
banco só entrega a fatura do cartão em **PDF**, e o PDF traz o que o OFX não traz: o vencimento,
o total a pagar, o mínimo e os encargos (IOF, juros, multa). Com ele, a fatura pode ser
**conferida ao centavo** (compras + encargos = total) mesmo sem o Meu Pluggy.

Ler PDF bem é um problema resolvido em Python (pdfplumber, sobre o pdfminer), não em Node. O
M10 (IA) também vai precisar de um serviço Python. Restrições: as do ADR-011 e do ADR-013 (só
grátis, só os 4 últimos dígitos, nada real em teste, Prisma 7 com migração aditiva, WCAG 2.2 AA,
visual igual ao canvas).

Combinado com o Danillo antes do código (15/10/2026, canvas E.4 aprovado):

- **leitor genérico + perfis**: um leitor que acha datas, valores e rótulos ("Vencimento",
  "Total da fatura") em qualquer fatura, e perfis pequenos por banco quando o genérico não basta;
- **compras + a fatura conferida**: as compras viram Recebidos; vencimento, total, mínimo e
  encargos viram a fatura do cartão, conferida ao centavo antes de importar;
- **senha pedida na hora, nunca guardada**: muito PDF de fatura vem com senha (parte do CPF);
- **container interno**: o serviço roda ao lado do app, só na rede interna do Compose, sem porta
  aberta, com um token curto do Better Auth.

## Decisão

1. **Serviço `services/ml` (FastAPI + pdfplumber), gerenciado pelo uv** (`pyproject.toml` e
   `uv.lock` versionados). Uma rota de trabalho: `POST /v1/faturas` com o corpo cru do PDF
   (`application/pdf`, sem multipart, que grava arquivo grande em disco), até 5 MB e 30 páginas.
   A senha, quando há, vai no cabeçalho `X-Pdf-Password` (base64url) só nesta chamada. A resposta
   é a fatura lida, com dinheiro em TEXTO decimal ("-199.90") e datas civis; erro sai só como
   código (`PDF_*`). O log leva só o código: nunca o PDF, a senha, valor ou descrição. A ponte
   `services/ml/package.json` deixa o `pnpm check` (Turbo) rodar o ruff e o pytest daqui.
2. **O leitor é genérico, com perfis (`app/perfis.py`).** Cada perfil diz os rótulos de
   vencimento, total, mínimo e fechamento, as linhas que não são compra (pagamento, saldo
   anterior) e como o banco chama cada encargo. O perfil é escolhido pela marca no texto; sem
   marca, o genérico. Uma linha é compra quando começa por data e termina por valor (com o
   sufixo C, CR ou "-" de crédito). O ano vem do vencimento (compra de dezembro na fatura de
   janeiro é do ano anterior). `python -m app.estrutura fatura.pdf` mostra só a ESTRUTURA de um
   PDF real (rótulos achados, formato das linhas, sem nenhum valor) para ajustar um perfil sem
   que o PDF saia do computador.
3. **Token curto, conferido pelo JWKS.** O app assina com o plugin `jwt` do Better Auth (EdDSA,
   chave Ed25519 na tabela `jwks`, privada cifrada com o `BETTER_AUTH_SECRET`): `iss fintrack`,
   `aud fintrack-ml`, `sub` = a pessoa, 2 minutos. Só o servidor assina (`auth.api.signJWT`); a
   rota `/token` do plugin está desligada, então o token nunca chega ao navegador. O serviço
   confere assinatura, emissor, público e validade pela chave pública de `/api/auth/jwks`.
4. **O mesmo caminho do OFX.** `@fintrack/importers` converte a resposta no `StatementFile`, o
   mesmo tipo que o leitor de OFX devolve (agora com `format`, `invoice` e `profile`); a
   conferência e a gravação (`file-imports.ts`) não sabem de onde o extrato veio. O formato é
   decidido pelos primeiros bytes (`%PDF-`), nunca pelo nome. As linhas do PDF não têm id: o id
   é um hash da data, do valor, da descrição e da ordem entre as linhas iguais (`p:` + hash), e
   a origem do lançamento é `PDF`.
5. **A senha.** O PDF com senha volta com `PDF_PASSWORD_REQUIRED`; a tela pede a senha
   ("Este PDF tem senha") e o arquivo, que ficou só na aba (o servidor não o guarda), volta junto
   com ela. O campo tem `autocomplete="off"`; a senha não vai para log, banco, auditoria ou
   navegador. Senha errada: `PDF_PASSWORD_WRONG`, com o aviso no mesmo passo.
6. **A fatura na conferência.** `invoiceCheck` (com o `settlementCheck` do ADR-011): compras e
   créditos lidos + encargos = total impresso? Confere ao centavo, ou "faltam/sobram R$ X", com o
   aviso "Confira se o PDF tem todas as páginas" e o botão "Importar mesmo assim". A diferença
   vista fica gravada no arquivo importado (`file_import.invoiceDifference`).
7. **Ao importar o PDF**, na mesma transação: a fatura do cartão (`card_statement`) do
   vencimento impresso (`statementForDueDate`, pelo ciclo da conta ou pelo fechamento impresso) é
   criada (`CLOSED`, origem `PDF`) ou atualizada, com total, mínimo e encargos
   (`statement_charge`). Os encargos não viram lançamento. As compras novas e as que já estavam
   na conta (a mesma do Meu Pluggy ou do OFX) passam a apontar para ela (`statementId`). **A
   fatura que o Meu Pluggy já trouxe vale mais**: o PDF só liga as compras, não troca total nem
   encargos (e a busca do Meu Pluggy sobrescreve uma fatura que veio do PDF).
8. **Sem duplicar entre formatos (`matchImportRows`).** Além do mesmo id e do Meu Pluggy, a
   mesma compra (mesmo valor e data) que já entrou pelo OUTRO formato conta como "já importado":
   o OFX do mês e depois o PDF da fatura, ou o contrário. Cada lançamento cobre uma linha só.
9. **Produção:** o serviço `ml` no Compose, na rede interna junto do `web`, sem porta publicada,
   com sistema de arquivos só de leitura, `/tmp` em memória e limite de memória; imagem
   `fintrack-ml` no GHCR, construída e testada no CI como a `web`. O app o encontra por
   `ML_SERVICE_URL` (`http://ml:8001`). Sem a variável, o PDF é recusado com um aviso e o OFX
   continua funcionando.

## Alternativas consideradas

- **Ler PDF em Node (pdf.js, pdf-parse):** a extração de texto com posição é bem mais fraca que
  a do pdfminer, e as tabelas de fatura dependem dela. O serviço Python também serve ao M10.
- **Um serviço de OCR ou de IA para ler a fatura:** pago, ou manda a fatura para fora. O PDF
  escaneado (só imagem) é recusado com uma frase (`PDF_NO_TEXT`).
- **Guardar a senha do PDF** (para a fatura do mês seguinte): é parte do CPF da pessoa; o custo
  de digitar de novo é pequeno.
- **Um segredo fixo compartilhado entre app e serviço:** mais um segredo para gerar e trocar.
  O JWKS do Better Auth já existe, o token vence em 2 minutos e diz quem pediu.
- **Multipart no envio ao serviço:** o Starlette grava partes grandes em arquivo temporário; o
  corpo cru fica só na memória.
- **Perfis só por banco, sem o genérico:** cada banco novo pararia até alguém escrever o perfil.

## Consequências

- Migração aditiva `fatura_em_pdf`: o valor `PDF` em `file_import_kind`; em `file_import`, as
  colunas `profile`, `invoiceDifference` e `statementId` (com índice e chave para
  `card_statement`); a tabela `jwks` do Better Auth. CHECKs: perfil, diferença e fatura só no PDF
  (`file_import_pdf_fields_check`), nome do perfil de 1 a 60 caracteres, e a linha que vem de
  arquivo (OFX **ou PDF**) aponta para ele (`transaction_file_import_check`, refeito). Cada um com
  teste de integração.
- `serverActions.bodySizeLimit` sobe para 6 MB (o PDF vai até 5 MB).
- Variável nova `ML_SERVICE_URL` (web). O serviço lê `ML_JWKS_URL` (padrão
  `http://127.0.0.1:3000/api/auth/jwks`; em produção `http://web:3000/api/auth/jwks`).
- A página do cartão mostra a fatura do PDF ("Da fatura em PDF") e confere com as compras
  ligadas de qualquer origem importada (Meu Pluggy, OFX, PDF).
- O CI ganha o uv e o Python no job de qualidade e no E2E, e uma imagem a mais para construir,
  testar e publicar.

## Revisão do M12.3b (28/10/2026)

**Continua valendo.** Serviço Python só na rede interna, token curto pelo JWKS, senha do PDF
nunca guardada. O serviço também passou a hospedar o classificador (ADR-015) e a ponte da IA
local (ADR-016).

- **Em aberto:** o perfil do PDF do banco do Danillo, que depende da estrutura (`app.estrutura`)
  de uma fatura real lida no computador dele (pendências do README).
