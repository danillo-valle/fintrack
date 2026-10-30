# ADR-024: A preparação para os dados reais: zerar, backup de ponta a ponta, alerta e ZAP ativo

- Status: aceita
- Data: 2026-10-29
- Módulo: M12.4a

## Contexto

A v1.0.0 (M12.4b) é a virada: a produção deixa de ter dados de teste e passa a ter os da casa.
Antes dela, o relatório do M12.3b deixou duas pendências de prioridade alta (a varredura ativa do
ZAP e o alerta automático dos eventos de segurança), e a decisão de 24/10 pedia um jeito de zerar
a produção mantendo os logins. E o backup, que vai passar a guardar os dados de verdade, precisava
de uma prova mais forte que "o banco restaurado tem usuários e lançamentos".

Decidido pelo Danillo em 29/10/2026: o M12.4 em duas partes (esta prepara e prova tudo; a M12.4b
zera a produção, faz a primeira importação real e solta a v1.0.0); as duas pendências altas
entram antes da v1.0.0; a auditoria **também** é apagada no zerar; o `fintrack-skills` com as
skills genéricas, reescritas (M12.4b).

## Decisão

1. **Zerar (`deploy/bin/fintrack-zerar`, `deploy/sql/zerar.sql`)**:
   - a lista é do que **fica**: `user`, `account`, `twoFactor`, `passkey`, `session`, `jwks` e
     `_prisma_migrations`. Todo o resto do schema `public` sai (`TRUNCATE`, sem `CASCADE`),
     inclusive tabela que vier depois, e os trabalhos pendentes da fila (`pgboss.job`); os
     horários fixos ficam. Os modelos do classificador (volume `ml-modelos`) também saem;
   - uma transação só, que confere no fim, ainda dentro dela, que só os logins ficaram (senão
     desfaz tudo); rodar de novo num banco zerado não dá erro;
   - na produção: confirmação digitada, backup `manual` obrigatório antes (o caminho de volta é o
     `fintrack-restore-prod` com ele), o app e o serviço Python parados durante, o `/api/health`
     conferido depois e uma linha em `estado/zerar.log`;
   - `--ensaio` roda o mesmo SQL no banco do `fintrack-restore-test --manter` (uma cópia do
     backup, sem internet), para ver o resultado com os dados de verdade antes da produção.
2. **A auditoria continua só de acréscimo, com uma saída** (migração `*_zerar_auditoria`, que
   troca só a função do gatilho do M04): `TRUNCATE` passa quando a transação liga
   `SET LOCAL fintrack.zerar = 'sim'`, o que só o `zerar.sql` faz. `UPDATE` e `DELETE` continuam
   recusados sempre, com ou sem a marca. Como antes, a trava protege contra um bug do app e contra
   uma consulta digitada por engano, não contra quem administra o banco.
3. **Backup de ponta a ponta**:
   - o `fintrack-backup` grava ao lado de cada backup um **manifesto** (quantas linhas cada tabela
     tem, `deploy/sql/contagens.sql`), cifrado com a mesma chave e copiado para o Drive. As
     contagens são feitas antes e depois do `pg_dump`; se o banco mudou no meio, o backup é refeito
     (uma vez); sem estabilidade, o backup fica sem manifesto (e o log avisa);
   - `fintrack-restore-test --completo` (com `--do-drive`, a prova inteira: Drive → decifrar →
     restaurar) confere o banco restaurado contra o manifesto, tabela a tabela, e liga o app da
     versão no ar sobre ele, numa rede interna do Docker (sem internet, filas desligadas), exigindo
     `/api/health` ok com a versão certa e `/entrar` 200. O banco temporário passou da rede `none`
     para essa rede interna.
4. **Alerta dos eventos de segurança (`deploy/bin/fintrack-alerta`, timer a cada 15 min)**: conta
   os mesmos eventos do `fintrack-status` na última janela e compara com limites (padrões no
   script, trocáveis em `operacao.env`); acima de algum, avisa o Healthchecks.io com `/fail` e um
   texto só com nome do evento, quantidade e limite (nunca IP, e-mail ou caminho). Abaixo, avisa
   "ok": o Healthchecks também denuncia o alerta parado. `--teste` confere o e-mail.
5. **ZAP ativo numa cópia local (`scripts/zap/copia-local.sh`)**: sobe uma cópia descartável
   (`scripts/zap/compose.copia.yml`: banco em memória, Mailpit, a imagem `:main`, só no
   127.0.0.1), cria a conta de teste e o seed, roda o `varrer.sh` com `ZAP_MODO=ativo` sem sessão e
   com sessão, e apaga tudo. O modo ativo é o mesmo `plano.yaml` (as mesmas exceções) com o job do
   `scripts/zap/ativo.yaml` no lugar da linha `# @ativo`, o spider enviando também formulários POST,
   e só aceita endereço local. Fica fora do CI (leva até uma hora e ataca de verdade); roda antes de
   cada versão grande.
6. **Texto de fora limpo na entrada (achado da varredura ativa)**: no laboratório, o ZAP mandou um
   caractere nulo na busca da lista (`/lancamentos?q=`) e o Postgres, que não guarda U+0000,
   respondeu com erro: 33 erros 500 (`request.error`), sem dado na tela e sem nada gravado. Revendo
   todas as entradas de texto, apareceu um segundo problema, mais sério: um caractere invisível
   entre os dígitos ("4111<largura zero>1111...") passava pela conferência de número de cartão do
   bot. A correção é uma função só, `cleanText` (`packages/core/src/text.ts`), que tira os
   caracteres de controle e os invisíveis (`\p{Cc}`, `\p{Cf}`) e troca os espaços diferentes pelo
   comum, aplicada **na entrada, antes de qualquer conferência**:
   - formulários: `textField()` (`apps/web/src/lib/text-field.ts`) em todo campo de texto livre dos
     schemas; um teste lê os schemas e barra `z.string()` sem `textField()` nem formato fixo;
   - a busca da URL (`parseFilters`), o nome da pessoa no Better Auth (cadastro e
     `update-user`), a mensagem do bot (`parseBotMessage`) e todo texto lido da Pluggy, do OFX e
     do PDF (os leitores `str`/`text` de cada importador e o `importedDescription`);
   - a conferência de cartão do bot olha o texto como ele aparece: além da limpeza, os dígitos
     largos (`４１１１`) e os traços diferentes viram os comuns (NFKC).
     A senha, o segredo da Pluggy e o `next` ficam como chegaram: não vão ao banco como texto.

## Consequências

- A v1.0.0 começa com os logins de hoje e nada mais; o caminho de volta do zerar é o backup feito
  por ele.
- A prova de backup mensal passa a ser o `--completo --do-drive`; os backups anteriores ao M12.4
  não têm manifesto (o `--completo` pede um novo).
- Um evento de segurança acima do limite chega por e-mail em até 15 minutos, sem dado de pessoa.
- O resultado da varredura ativa (e as exceções, se houver) fica no documento do OWASP.
- Texto com caractere nulo ou invisível não derruba mais uma tela nem uma importação, e não
  esconde um número de cartão do bot. Campo de texto novo num schema usa `textField()` (o teste
  barra o esquecimento); leitor novo de banco ou de arquivo passa o texto pelo `cleanText`.
- Tabela nova do domínio sai no zerar sem mexer nele; tabela nova de login precisa entrar na lista
  do `zerar.sql` (o teste de integração confere os logins).

## Alternativas consideradas

- **Manter a auditoria no zerar** (a recomendação): preservava a trava sem exceção; o Danillo
  preferiu começar a v1.0.0 sem histórico, e a exceção ficou estreita (só `TRUNCATE`, só com a
  marca, só numa transação).
- **Desligar o gatilho no zerar** (`ALTER TABLE ... DISABLE TRIGGER`): mais simples, mas deixa a
  tabela sem trava enquanto durar, e um erro no meio poderia deixá-la desligada.
- **Contagens por `pg_export_snapshot`** (exatas mesmo com o banco mudando): pedem uma sessão
  segurando a transação durante o `pg_dump`; com a casa sem escrita às 03:30, conferir antes e
  depois dá o mesmo resultado com muito menos peças.
- **Alerta por e-mail direto (Resend)**: mais uma credencial no servidor; o Healthchecks já está
  configurado, manda o e-mail de graça e ainda avisa se o alerta parar.
- **ZAP ativo no CI**: uma hora a mais em cada PR, atacando com dados de teste; fica para a cópia
  local, antes de cada versão grande.
- **Limpar o texto no banco** (um adaptador do Prisma que tira o U+0000 de todo parâmetro): um
  lugar só, mas a conferência (a de cartão do bot, os limites de tamanho) olharia um texto e o
  banco guardaria outro; o cartão escondido por um nulo seria gravado inteiro. A limpeza tem de vir
  antes da conferência.
- **Recusar em vez de limpar**: o formulário diria "caractere inválido" para um texto colado de
  outro app com um invisível (comum ao copiar de PDF ou de site); limpar dá o resultado que a
  pessoa vê na tela.
