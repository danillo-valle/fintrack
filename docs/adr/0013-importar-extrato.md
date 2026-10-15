# ADR-013: Importar extrato OFX

- Status: aceita
- Data: 2026-10-14
- Módulo: M09.3 (desenho no canvas, linha E.3)

## Contexto

O Meu Pluggy (ADR-011) traz o que o banco mostra no Open Finance, mas nem todo banco ou período
está lá: conta de banco que não está no Meu Pluggy, meses antes da data de corte, um cartão que
a pessoa não ligou. Quase todo banco brasileiro deixa baixar o extrato da conta e a fatura do
cartão em **OFX**. Falta o FinTrack aceitar esse arquivo sem duplicar o que já veio pelo Meu
Pluggy e sem guardar dado que não precisa.

Restrições: as do ADR-011 (só grátis, só os 4 últimos dígitos, nada real em teste, Prisma 7 com
migração aditiva, WCAG 2.2 AA, visual igual ao canvas).

Combinado com o Danillo antes do código (14/10/2026, canvas E.3 aprovado):

- **qualquer conta**, sem duplicar: na conta ligada ao Meu Pluggy, a linha do arquivo com o mesmo
  valor e a mesma data de um recebido do banco não entra ("já veio pelo Meu Pluggy");
- a **conta é sugerida** pelo arquivo (banco e final da conta ou do cartão) e a pessoa confirma;
- **OFX** da conta corrente e do cartão, versões 1.x (SGML, latin-1) e 2.x (XML), até **2 MB**, tipo
  conferido pelos primeiros bytes;
- **só a impressão digital** fica: o arquivo é descartado; o SHA-256 e um resumo ficam, para
  avisar "este arquivo já foi importado".

## Decisão

1. **Um leitor puro em `@fintrack/importers` (`ofx/parse.ts`).** Um tokenizador linear lê as duas
   versões (no SGML, as folhas não fecham; no XML, fecham e o fechamento é ignorado). Nada de
   DTD, entidade externa ou `eval`. Sai o tipo do FinTrack: centavos `bigint` exatos (vírgula ou
   ponto decimal, milhar), data civil (os 8 primeiros dígitos de `DTPOSTED`, sem converter fuso),
   só os 4 últimos dígitos da conta ou do cartão. O número inteiro (`ACCTID`) é lido e descartado
   ali mesmo; erros saem como código (`OFX_*`) sem dado do arquivo.
2. **`externalId` = FITID.** Sem FITID, ou com o mesmo FITID em mais de uma linha (há banco que
   repete), um hash estável de FITID + data + valor + descrição + a ordem entre as linhas iguais:
   importar o mesmo arquivo de novo dá os mesmos ids, e a chave única `(conta, OFX, id)` faz o
   resto. Linha de valor zero e o pagamento da fatura no extrato do cartão ficam de fora (contados).
3. **Duas etapas, nada gravado antes do "Importar".** O envio lê o arquivo na memória e grava só a
   conferência em `file_import` (`PREVIEW`, as linhas lidas em JSON, vence em 1 hora, só de quem
   enviou). "Importar" confere tudo de novo numa transação, passa a conferência a `IMPORTED` por
   UPDATE condicional (duas abas: um sucesso e um "não vale mais") e apaga as linhas guardadas
   (CHECK no banco). "Cancelar" apaga a conferência.
4. **Sem duplicar, regra pura no core (`classifyImportRows`).** Na conta escolhida: "já
   importado" (o mesmo id já entrou por outro arquivo) e "já veio pelo Meu Pluggy" (um recebido
   de origem `OPEN_FINANCE`, não apagado, com o mesmo valor e a mesma data; cada um cobre uma
   linha só). O resto entra como **Recebido** (`PENDING`, origem `OFX`, `fileImportId`), com a
   cascata de categoria e o ambiente pelo cartão, e ganha a revisão do ADR-012 de graça.
5. **A conta sugerida (`suggestImportAccount`).** Primeiro a conta que já recebeu um arquivo do
   mesmo banco e final; no cartão, a conta com um cartão ativo do mesmo final; senão a única do
   tipo certo. Empate: sem sugestão. A troca de conta é um formulário GET (`?conta=`) e a
   conferência é recalculada para ela.
6. **Quem importa:** quem edita a carteira da conta. O portador de um adicional (que lança só com
   o próprio cartão) não importa a fatura inteira: veria compras que não são dele.
7. **Sem reautenticação.** Importar só acrescenta Recebidos que ficam fora das somas até a pessoa
   conferir: o mesmo poder do "Novo lançamento". A reautenticação continua para o que tira dado
   do sistema (CSV) e para as credenciais do Meu Pluggy.

## Alternativas consideradas

- **Biblioteca de OFX do npm:** as mais usadas convertem valores para `number` (perde centavos)
  e não tratam latin-1; o formato é pequeno o bastante para um leitor próprio com teste.
- **Guardar o arquivo** (para reimportar ou auditar): é extrato bancário inteiro, com número de
  conta e de cartão. A impressão digital basta para o aviso de arquivo repetido.
- **Duplicado pela descrição:** o texto do OFX e o do Open Finance raramente batem. Valor e data
  exatos erram pouco, e o que escapar aparece como par na revisão.
- **Importar direto, sem conferência:** a pessoa não veria a conta escolhida nem o que seria
  pulado antes de gravar.

## Consequências

- Tabela nova `file_import` e coluna opcional `transaction.fileImportId` (migração aditiva), com
  CHECKs: SHA-256 em hexadecimal, nome de 1 a 120 caracteres, final com 4 dígitos, contagens não
  negativas, importado com conta e sem as linhas, período em ordem e só origem OFX aponta para o
  arquivo. Cada uma com teste de integração.
- `serverActions.bodySizeLimit` sobe para 3 MB (o leitor recusa mais de 2 MB).
- Evento de auditoria novo `file.imported`, só com ids e contagens.
- O PDF da fatura (M09.4) entra pelo mesmo caminho: outro leitor, a mesma conferência (ADR-014).
