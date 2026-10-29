# Runbook de incidente

O que fazer quando algo dá errado de verdade na produção: o FinTrack fora do ar, um número errado
nas somas, uma suspeita de invasão. O [runbook de operação](runbook.md) tem os comandos de cada
peça; este aqui diz **a ordem**: confirmar, estabilizar, avisar, consertar e aprender. Escrito para
uma pessoa só operando, de madrugada, com pressa.

Regra de ouro: **primeiro parar o estrago, depois entender, por último consertar.** E nunca apagar
o que serve de prova (log, backup, o banco como está) antes de entender o que houve.

## 1. Qual a gravidade

| Gravidade | Exemplos                                                                                                                                 | Reação                                  |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **G1**    | O app fora do ar para todos; dinheiro errado nas somas ou lançamentos sumindo; suspeita de invasão, de segredo vazado ou de dado exposto | Agora. Siga este runbook do começo      |
| **G2**    | Uma parte quebrada, o resto funciona: o bot não responde, a busca do banco parou, o PDF é recusado, o backup falhou                      | No mesmo dia. Pule para a seção da peça |
| **G3**    | Incômodo sem perda: uma tela lenta, um aviso que não aparece, um alerta falso                                                            | Vira issue no GitHub                    |

Na dúvida entre duas, fique com a mais grave. Rebaixar depois é barato.

## 2. Os primeiros 15 minutos (G1)

1. **Confirme de fora.** De outro aparelho, fora do Wi-Fi de casa (o 4G do celular):
   ```bash
   bash deploy/bin/smoke-test https://<seu domínio>      # do seu computador, qualquer rede
   ```
   E no servidor: `sudo -u fintrack fintrack-status`. Luz e internet de casa primeiro: metade das
   quedas é isso, e aí não há o que fazer no software.
2. **Anote a hora e abra a ficha.** Copie o modelo do fim desta página para um arquivo no seu
   computador (não no servidor, que pode ser o problema) e escreva a primeira linha da linha do
   tempo: "HH:MM, vi X".
3. **Guarde a prova antes de mexer.** Um backup manual e os logs da última hora, cifrados com a
   mesma chave pública do backup:
   ```bash
   sudo -u fintrack fintrack-backup manual
   sudo -u fintrack fintrack-compose logs --since 2h --no-log-prefix web caddy \
     | age -R /srv/fintrack/backup-recipient.txt > ~/incidente-$(date +%Y%m%d-%H%M)-logs.age
   ```
   O log não tem senha, código, texto de mensagem nem número inteiro (ADR-005, ADR-018), mas tem
   IPs: por isso vai cifrado.
4. **Estabilize** com a alavanca menor que resolve (seção 3). Não conserte ainda.
5. **Avise a casa** (seção 5): quem usa o FinTrack precisa saber se deve parar de lançar.

## 3. As alavancas, da menor para a maior

| Situação                                       | Alavanca                                                                                                    | Volta                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| A versão nova quebrou algo                     | Voltar uma versão (runbook, "Voltar uma versão de propósito")                                               | `fintrack-deploy <commit novo>`    |
| A busca do banco grava errado ou em excesso    | Parar as buscas sem derrubar o site: `SYNC_WORKER off` (runbook, "Busca do banco")                          | `SYNC_WORKER on`                   |
| O bot lança errado ou responde o que não devia | Ajustes › Bot de lançamento, o interruptor do lar; ou, no painel da Meta e no `setWebhook`, tirar o webhook | O interruptor de novo              |
| A IA local sugere bobagem                      | Ajustes › Categorização, desligar a IA local; `sudo -u fintrack fintrack-llm desligar`                      | Ligar de novo                      |
| Dado apagado ou corrompido                     | Parar de lançar (avise a casa) e seguir a seção 4, "Dinheiro errado"                                        | A restauração                      |
| Suspeita de invasão ou de segredo vazado       | A seção 4, "Invasão ou segredo vazado"                                                                      | Não há volta: troca-se o que vazou |
| O servidor não sobe                            | Runbook, "O app não sobe" e "Servidor perdido"                                                              | A máquina nova com o backup        |

## 4. Os três incidentes que mais importam

### O FinTrack fora do ar

1. `fintrack-status`: o `web` está de pé? O `/api/health` diz `ok` com o banco `ok`?
2. Erro da Cloudflare (1033, 502) é o túnel: runbook, "O site mostra erro da Cloudflare".
3. Caiu logo depois de um deploy: a volta automática já deveria ter agido (e-mail do
   Healthchecks). Se não agiu, volte à mão (runbook, "Voltar uma versão de propósito").
4. Disco cheio derruba o Postgres sem aviso bonito: runbook, "Disco cheio".

### Dinheiro errado nas somas, ou lançamentos sumindo

O sistema foi feito para isto não acontecer calado: as somas vêm do banco e o painel é conferido
contra a lista ao centavo (ADR-010), o que vem do banco fica fora das somas até a revisão (ADR-011)
e a auditoria só acrescenta (ADR-004). Então, quando acontece, a pergunta é **o que mudou**:

1. Peça à pessoa o caminho exato (a tela, o filtro, o número que esperava). Nunca peça print com
   valores para mandar a ninguém de fora.
2. A auditoria diz quem mudou o quê e quando, sem valores nem descrições:
   ```bash
   sudo -u fintrack fintrack-compose exec db psql -U fintrack -c \
     'SELECT "createdAt", action, "actorId" FROM audit_log ORDER BY "createdAt" DESC LIMIT 30;'
   ```
3. Antes de qualquer conserto, **restaure o backup de antes do problema num banco temporário** e
   compare: assim você sabe o tamanho do estrago sem tocar na produção. O `--manter` deixa o banco
   no ar, sem rede; o `--apagar` o tira (ele tem os dados decifrados, então não esqueça):
   ```bash
   ls -1 /srv/fintrack/backups/                                       # o de antes do problema
   sudo -u fintrack fintrack-restore-test /srv/fintrack/backups/<arquivo> --manter
   sudo -u fintrack docker exec -it fintrack-restore-test psql -U fintrack -d fintrack
   sudo -u fintrack fintrack-restore-test --apagar                    # ao terminar
   ```
4. Conserto pelo app (desfazer, excluir, editar) sempre que der: ele grava a auditoria e avisa o
   cache. Restaurar a produção (runbook, "Restaurar a produção") só se o estrago for grande, e
   lembrando que tudo depois do backup se perde: combine com a casa antes.
5. **Nunca** edite o banco na mão sem um backup manual logo antes, e nunca apague linha da
   auditoria (o gatilho recusa, de propósito).

### Invasão ou segredo vazado

Sinais: eventos `auth.*` fora do normal (runbook, "Eventos de segurança"), uma sessão que ninguém
reconhece em Ajustes › Segurança, um segredo colado num chat ou num commit.

1. **Feche a porta.** Troque o segredo que vazou (runbook, "Trocar um segredo"). Na dúvida sobre
   uma conta, derrube **todas** as sessões (todos entram de novo com senha e 2FA):
   ```bash
   sudo -u fintrack fintrack-compose exec db psql -U fintrack -c 'DELETE FROM "session";'
   ```
2. **Veja o alcance** nos eventos de segurança e na auditoria das últimas 72 h. Exportação de CSV
   aparece como `transactions.exported` (só o período e a quantidade).
3. Senha de alguém comprometida: a pessoa troca em Ajustes › Segurança (as outras sessões caem).
   Token da Meta, do Telegram ou do Meu Pluggy: revogue no painel deles, não só aqui.
4. Segredo num commit: trocar o segredo resolve; reescrever o histórico do Git não (cópias já
   existem). O gitleaks do CI deveria ter barrado: entenda por que não barrou.
5. Dados de pessoa expostos: além de consertar, avise as pessoas afetadas com o que foi exposto,
   quando e o que já foi feito. Sem minimizar.

## 5. Avisar a casa

Curto, sem jargão, com o que fazer agora. Um modelo para o WhatsApp da casa:

> O FinTrack está com problema desde HH:MM: [o que a pessoa vê]. Enquanto isso, [não lance /
> pode usar normalmente / anote os gastos à parte]. Aviso quando voltar ao normal.

E um segundo aviso quando acabar, com o que foi perdido (se algo foi).

## 6. Depois: o pós-incidente

Em até dois dias, com a cabeça fria. **Sem culpa**: o objetivo é o sistema ficar mais difícil de
quebrar, não achar quem errou. Toda ação sai com um dono e uma data, vira issue no GitHub e, se
mudar uma decisão, um adendo no ADR.

A ficha vai para o repositório só se não tiver nada sensível: nenhum valor, descrição de
lançamento, segredo, IP, número inteiro de telefone ou de cartão. Na dúvida, fica fora do Git.

```markdown
# Incidente AAAA-MM-DD: <título curto>

- Gravidade: G1 | G2 | G3
- Duração: HH:MM a HH:MM (X min)
- Quem percebeu e como: <alerta, pessoa da casa, eu mesmo>

## Linha do tempo

- HH:MM vi ...
- HH:MM fiz ...

## Impacto

O que as pessoas não conseguiram fazer e o que se perdeu (sem valores).

## Causa

A causa técnica e, mais importante, por que as proteções não pegaram antes.

## O que funcionou

## Ações

| Ação | Dono | Até | Issue |
| ---- | ---- | --- | ----- |
```

## 7. Treinar antes de precisar

- **Todo mês**, o teste de restauração (runbook, "Teste de restauração") já é um ensaio da
  alavanca maior.
- **A cada três meses**, um ensaio de mesa: escolha um dos três incidentes da seção 4 e percorra o
  runbook sem executar o que é destrutivo, conferindo se cada comando e cada link ainda valem.
  Comando que mudou é conserto neste documento, no mesmo dia.
