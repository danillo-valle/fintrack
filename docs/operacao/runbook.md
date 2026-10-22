# Runbook de operação do FinTrack

O que fazer em cada situação da produção, com os comandos prontos. Decisões e motivos estão no
[ADR-005](../adr/0005-hospedagem-e-deploy.md). Todos os comandos rodam no servidor `home`, no
seu usuário, com `sudo -u fintrack` (é o usuário `fintrack` quem lê os arquivos de variáveis).

Dica: crie um atalho no seu `~/.bashrc` para digitar menos.

```bash
alias ft='sudo -u fintrack'   # ft fintrack-status, ft fintrack-compose ps ...
```

## Mapa rápido

| O quê                                | Onde                                                            |
| ------------------------------------ | --------------------------------------------------------------- |
| Variáveis (segredos)                 | `/srv/fintrack/.env`, `app.env`, `operacao.env` (600)           |
| Chave pública do backup              | `/srv/fintrack/backup-recipient.txt`                            |
| Chave privada do backup              | **fora do servidor**: no seu gerenciador de senhas              |
| Backups locais                       | `/srv/fintrack/backups/` (14 diários, 5 pré-deploy, 10 manuais) |
| Backups fora de casa                 | Google Drive, pasta `fintrack-backups` (30 dias)                |
| Histórico de deploys e restaurações  | `/srv/fintrack/estado/deploys.log`, `restauracoes.log`          |
| Arquivos de deploy (não edite à mão) | `/srv/fintrack/repo/deploy/` (reescrita a cada deploy)          |
| Ajustes só desta máquina             | `/srv/fintrack/compose.override.yml` (opcional)                 |

| Comando                              | Para quê                                            |
| ------------------------------------ | --------------------------------------------------- |
| `fintrack-status`                    | Tudo numa tela: versão, saúde, deploys, backups     |
| `fintrack-compose <args>`            | O `docker compose` da produção (ps, logs, exec...)  |
| `fintrack-deploy <commit> [--force]` | Põe um commit no ar (com backup e volta automática) |
| `fintrack-backup [manual]`           | Backup agora                                        |
| `fintrack-restore-test [--do-drive]` | Prova que um backup restaura (num banco temporário) |
| `fintrack-restore-prod <arquivo>`    | Restaura a PRODUÇÃO (desastre)                      |
| `deploy/bin/smoke-test <endereço>`   | Teste de fumaça de qualquer máquina, sem login      |

## Ver o estado

```bash
sudo -u fintrack fintrack-status
journalctl -u fintrack-update --since today        # o que o deploy automático fez hoje
journalctl -u fintrack-backup --since "7 days ago" # os backups da semana
```

Logs do app (JSON, uma linha por acontecimento). Algumas linhas internas do Better Auth saem em
texto; o `fromjson?` abaixo mostra as duas sem quebrar:

```bash
sudo -u fintrack fintrack-compose logs --since 1h --no-log-prefix web \
  | jq -R 'fromjson? // {texto: .}'                                  # tudo, legível
sudo -u fintrack fintrack-compose logs --since 24h --no-log-prefix web \
  | jq -R 'fromjson? | select(.level == "error")'                    # só os erros
sudo -u fintrack fintrack-compose logs --since 1h --no-log-prefix caddy \
  | jq -R 'fromjson? | select(.status >= 500) | {ts, uri: .request.uri, status, ip: .request.client_ip}'
```

Achar um erro a partir da tela: a tela de erro mostra um código ("digest"). Procure por ele:

```bash
sudo -u fintrack fintrack-compose logs --no-log-prefix web | jq -R 'fromjson? | select(.digest == "COLE-O-CODIGO")'
```

## Deploy

**Como acontece:** merge na `main` → CI verde → o job `publicar` aponta `:main` para as imagens do
commit → em até 1 minuto o `fintrack-update.timer` percebe e roda o `fintrack-deploy`.

| Situação                               | Comando                                                      |
| -------------------------------------- | ------------------------------------------------------------ |
| Pausar os deploys (manutenção, viagem) | `sudo systemctl stop fintrack-update.timer`                  |
| Retomar                                | `sudo systemctl start fintrack-update.timer`                 |
| Pôr no ar um commit específico         | `sudo -u fintrack fintrack-deploy <commit de 40 caracteres>` |
| Tentar de novo um commit que falhou    | `sudo -u fintrack fintrack-deploy <commit> --force`          |
| Ver quanto tempo levou do merge ao ar  | `tail -n 5 /srv/fintrack/estado/deploys.log`                 |

### Voltar uma versão de propósito

Encontre o commit anterior no `deploys.log` (linhas com `ok`) e faça o deploy dele. As imagens das
últimas 3 versões ficam no servidor, então é rápido. As migrações não voltam (são aditivas, e a
versão anterior funciona com o banco novo):

```bash
grep ' ok ' /srv/fintrack/estado/deploys.log | tail -n 3
sudo -u fintrack fintrack-deploy <commit-anterior> --force
sudo systemctl stop fintrack-update.timer   # senão, em 1 minuto ele traz a :main de volta
```

Depois, corrija na `main` (um PR que desfaz ou conserta) e religue o timer.

### Um deploy falhou (e-mail do Healthchecks)

1. `sudo -u fintrack fintrack-status`: a versão anterior está no ar? (deveria: a volta é automática)
2. `journalctl -u fintrack-update --since "1 hour ago"`: a linha `ERRO:` diz em que passo parou.
3. Pelo motivo:
   - **"não consegui baixar"**: o pacote no GHCR ficou privado ou a internet caiu. Confira a
     visibilidade em github.com/danillo-valle?tab=packages.
   - **"as migrações falharam"**: nada foi trocado. Leia a saída do Prisma no journal; a correção
     é um PR com uma migração nova (nunca edite a que falhou).
   - **"não respondeu ok no /api/health"**: o app novo subiu mas não funcionou. Veja os logs da
     tentativa: `sudo -u fintrack fintrack-compose logs --since 30m web`. Causa comum: variável
     nova que não foi colocada no `/srv/fintrack/app.env`.
4. O commit que falhou não é tentado de novo sozinho. Depois de corrigir (no `app.env` ou com um
   commit novo), use `fintrack-deploy <commit> --force` ou espere o próximo merge.

### O app não sobe (nem a versão anterior)

```bash
sudo -u fintrack fintrack-compose ps                        # quem está "unhealthy" ou parado?
sudo -u fintrack fintrack-compose logs --since 15m db web   # o motivo costuma estar aqui
df -h /                                                     # disco cheio derruba o Postgres
```

Se o banco não sobe por dados corrompidos, siga "Restaurar a produção".

### O site mostra erro da Cloudflare (1033 ou 502)

O app pode estar saudável e a frente parada. `sudo -u fintrack fintrack-compose ps` e veja
`cloudflared` e `caddy`:

| Sinal                                                                                | Causa                                                                                                                | O que fazer                                                                                                                                             |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1033; túnel _Inactive_ no painel; `cloudflared` reiniciando com `token is not valid` | Token do túnel errado                                                                                                | `sudo -u fintrack fintrack-definir .env TUNNEL_TOKEN` (só o texto `eyJ...` depois de `--token`) e `sudo -u fintrack fintrack-compose up -d cloudflared` |
| 502; `caddy` reiniciando com `exec /usr/bin/caddy: operation not permitted`          | Falta `cap_add: [NET_BIND_SERVICE]` no serviço caddy do compose (a imagem oficial grava essa capacidade no programa) | Corrija `deploy/compose.prod.yml` por PR; o deploy seguinte recria o caddy                                                                              |
| 502; `caddy` de pé                                                                   | O app não responde                                                                                                   | Siga "O app não sobe"                                                                                                                                   |

## Backup

- **Automático** às 03:30 (`fintrack-backup.timer`) e antes de todo deploy.
- **Manual**, antes de algo arriscado: `sudo -u fintrack fintrack-backup manual`
- **Conferir o Drive:** `sudo -u fintrack rclone --config /srv/fintrack/rclone.conf lsl gdrive-fintrack:fintrack-backups | tail`

### Teste de restauração (todo mês, no dia 1º)

```bash
sudo -u fintrack fintrack-restore-test --do-drive   # prova a cópia de fora de casa
```

Cole a chave privada quando pedir (do gerenciador de senhas). O resultado fica em
`/srv/fintrack/estado/restauracoes.log`. Um backup que nunca foi restaurado não é um backup.

## Restaurar a produção (desastre)

Banco corrompido, dados apagados por engano: escolha o backup (o mais novo **antes** do problema)
e rode. O script pede que você digite `RESTAURAR`, guarda o estado atual num backup "manual",
para o app, recria o banco, restaura, aplica migrações que faltarem e liga o app:

```bash
ls -1 /srv/fintrack/backups/                                   # escolha pelo horário (UTC)
sudo -u fintrack fintrack-restore-prod /srv/fintrack/backups/fintrack-AAAAMMDDTHHMMSSZ-diario.dump.age
```

O backup só está no Drive? Baixe para a pasta de backups antes:

```bash
sudo -u fintrack rclone --config /srv/fintrack/rclone.conf copy \
  gdrive-fintrack:fintrack-backups/NOME-DO-ARQUIVO.dump.age /srv/fintrack/backups/
```

## Servidor perdido, ou mudar de máquina (outra casa, VPS)

1. Na máquina nova (Ubuntu 24.04 com Docker, como no M00): `git clone` do repositório e
   `sudo bash deploy/servidor/preparar-servidor.sh`.
2. Recrie `/srv/fintrack/.env`, `app.env`, `operacao.env` e `backup-recipient.txt` a partir do
   gerenciador de senhas (por isso os valores ficam guardados lá também).
3. Refaça o `rclone config` (Drive) e copie o backup mais novo do Drive para `backups/`.
4. Primeiro deploy: `sudo -u fintrack fintrack-deploy <commit da :main>`.
5. Restaure: `sudo -u fintrack fintrack-restore-prod <backup>`.
6. Ligue os timers: `sudo systemctl enable --now fintrack-update.timer fintrack-backup.timer`.
7. Numa VPS (sem Cloudflare Tunnel), siga o apêndice do manual do M05 (Caddy com HTTPS próprio).

O mesmo token do túnel funciona na máquina nova: a Cloudflare passa a mandar as visitas para quem
estiver conectado com ele. Desligue o `cloudflared` da máquina antiga, se ela ainda existir.

## Trocar um segredo

Todo valor novo entra com o `fintrack-definir` (o secreto é pedido escondido, sem ir para o
histórico). Guarde o valor novo também no gerenciador de senhas.

| Segredo                  | Como trocar                                                                                                                                                                                                                             | Efeito colateral                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Token do túnel           | Painel Zero Trust → o túnel → **Refresh token**; `sudo -u fintrack fintrack-definir .env TUNNEL_TOKEN`; `sudo -u fintrack fintrack-compose up -d cloudflared`                                                                           | Alguns segundos fora do ar                                                              |
| Chave do Resend          | Crie outra (só envio, só o domínio); `sudo -u fintrack fintrack-definir app.env SMTP_PASSWORD`; `sudo -u fintrack fintrack-compose up -d web`; apague a antiga no Resend                                                                | Nenhum                                                                                  |
| Senha do banco           | `sudo -u fintrack fintrack-compose exec db psql -U fintrack -c "\password fintrack"` (digite a nova); `sudo -u fintrack fintrack-definir .env POSTGRES_PASSWORD` (a mesma); `sudo -u fintrack fintrack-compose up -d web`               | Alguns segundos fora do ar                                                              |
| `BETTER_AUTH_SECRET`     | `sudo -u fintrack fintrack-definir app.env BETTER_AUTH_SECRET --gerar-base64 32`; `sudo -u fintrack fintrack-compose up -d web`                                                                                                         | **Todas as sessões caem e o 2FA precisa ser refeito**                                   |
| Chave do backup (age)    | `age-keygen` novo; guarde a privada; troque o `backup-recipient.txt`                                                                                                                                                                    | Backups antigos continuam precisando da chave ANTIGA: guarde as duas até eles expirarem |
| `CONNECTION_SECRET_KEYS` | `sudo -u fintrack fintrack-definir app.env CONNECTION_SECRET_KEYS --gerar-chave N` (N = a próxima versão: a nova vai na frente, as antigas ficam); `sudo -u fintrack fintrack-compose up -d web`; guarde o valor inteiro no gerenciador | Nenhum. Só tire uma versão antiga depois que cada pessoa salvar as credenciais de novo  |

## Busca do banco (Meu Pluggy, M09.1)

A busca roda dentro do container `web` (fila pg-boss no próprio Postgres): todo dia às 04:30
(era 06:47 até o M10.2b: a IA local precisa da carga a tempo) e quando alguém aperta "Buscar
agora". Cada execução fica em Ajustes › Conexões bancárias ›
Sincronizações, com o resultado escrito.

```bash
# As últimas buscas no log (sem credencial nenhuma: só códigos e contagens)
sudo -u fintrack fintrack-compose logs --since 24h --no-log-prefix web | jq -R 'fromjson? | select(.event? // "" | startswith("sync."))'
# As últimas execuções no banco
sudo -u fintrack fintrack-compose exec db psql -U fintrack -c \
  "SELECT \"startedAt\", status, trigger, \"itemsCreated\", error FROM sync_run ORDER BY \"startedAt\" DESC LIMIT 10"
```

| Situação                                                    | O que fazer                                                                                                                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "a Pluggy recusou o Client Secret"                          | A pessoa trocou o Client Secret no painel da Pluggy: ela salva as credenciais de novo no app                                                                                                      |
| "a Pluggy não respondeu" / "a Pluggy pediu uma pausa"       | Nada: a fila tenta de novo duas vezes, e amanhã às 04:30 também                                                                                                                                   |
| Nenhuma busca desde ontem, sem erro                         | `sync.worker_failed` no log? Confira se o `web` está de pé (`fintrack-status`) e se `SYNC_WORKER` não está `off` no `app.env`                                                                     |
| Aviso "o servidor ainda não tem a chave"                    | Falta `CONNECTION_SECRET_KEYS` no `app.env`: veja "Trocar um segredo"                                                                                                                             |
| Chave perdida (servidor refeito sem a cópia do gerenciador) | `sudo -u fintrack fintrack-definir app.env CONNECTION_SECRET_KEYS --gerar-chave 2` (uma versão que a perdida não usava), reinicie o `web` e peça a cada pessoa que digite o Client Secret de novo |
| Parar as buscas sem derrubar o site                         | `sudo -u fintrack fintrack-definir app.env SYNC_WORKER off`; `sudo -u fintrack fintrack-compose up -d web`. Para voltar: `on`                                                                     |

## Fatura em PDF (serviço `ml`, M09.4)

O PDF da fatura é lido pelo container `ml` (Python), na rede interna `ml`: sem porta, sem
internet, sem banco. O app o chama em `http://ml:8001` (`ML_SERVICE_URL` no `app.env`); ele
confere o token do app em `http://web:3000/api/auth/jwks`. O PDF e a senha nunca vão para disco
nem para log.

```bash
# Saúde do serviço (o healthcheck da imagem)
sudo -u fintrack fintrack-compose ps ml
# As faturas recusadas (só o código e um detalhe sem dado do arquivo)
sudo -u fintrack fintrack-compose logs --since 24h --no-log-prefix web | jq -R 'fromjson? | select(.event? == "file.rejected")'
sudo -u fintrack fintrack-compose logs --since 24h ml
```

| Situação                                         | O que fazer                                                                                                                        |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| "O leitor de PDF não está ligado neste servidor" | Falta `ML_SERVICE_URL` no `app.env`: `sudo -u fintrack fintrack-definir app.env ML_SERVICE_URL http://ml:8001` e reinicie o `web`  |
| "O leitor de PDF não respondeu agora"            | `fintrack-compose ps ml`: fora do ar? `fintrack-compose up -d ml`. O OFX continua funcionando enquanto isso                        |
| "O leitor de PDF recusou o pedido"               | O token não passou (`ml.unauthorized` no log do `ml`): confira o relógio do servidor (`timedatectl`) e se o `web` responde ao JWKS |
| Uma fatura de um banco novo não é lida           | Ajuste de perfil (skill `importador`): `python -m app.estrutura` no PDF, no seu computador; o PDF nunca vai para o servidor ou Git |

## Classificador de categorias (serviço `ml`, M10.1)

O mesmo container `ml` também sugere categorias. Os modelos (um por carteira, treinados com os
lançamentos da casa) ficam SÓ no volume `fintrack-prod_ml-modelos`, montado em `/data/modelos`;
o resto do container continua só leitura. O treino roda na fila do app todo dia às 03:15 (e no
"Treinar agora" de Ajustes › Categorização). O volume fica fora do backup: o treino refaz tudo.

```bash
# O último treino (só contagens: carteiras treinadas, sem mudança, com poucos exemplos, falhas)
sudo -u fintrack fintrack-compose logs --since 30h --no-log-prefix web | jq -R 'fromjson? | select(.event? == "classifier.trained")'
# Os modelos no volume (nomes = ids das carteiras; nenhum dado legível)
sudo -u fintrack fintrack-compose exec ml ls -la /data/modelos
```

| Situação                                         | O que fazer                                                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| "O classificador não está ligado neste servidor" | Falta `ML_SERVICE_URL` no `app.env` (a mesma do PDF): veja a seção acima                                    |
| "O classificador não respondeu" no Treinar agora | `fintrack-compose ps ml`; `logs ml` com `ml.train_rejected`. As outras camadas da cascata continuam valendo |
| Treino falha com "Read-only file system"         | O volume não montou: `fintrack-compose up -d ml` (o compose do M10.1 traz o `ml-modelos`)                   |
| Quer apagar todos os modelos                     | `fintrack-compose stop ml`, `docker volume rm fintrack-prod_ml-modelos`, `up -d ml`; voltam às 03:15        |

## Medir um LLM local (M10.2a, ADR-007)

A medição roda com o SEU usuário (grupo `docker`), não com o `fintrack`, e não toca na produção:
ela só lê o `/api/health` do container `web` pelo IP dele na rede `fintrack-prod_entrada`. O
llama-server sobe num container próprio (`fintrack-llm-medicao`) e é derrubado no fim, até com
Ctrl+C. Modelos e resultados ficam em `~/fintrack-llm`, fora do repositório. Detalhes em
`services/ml/bench/README.md`.

```bash
# Dentro de um tmux (a medição completa leva de 15 a 60 min por modelo)
tmux new -s medicao
services/ml/bench/medir-llm.sh --rapido qwen2.5-1.5b
services/ml/bench/medir-llm.sh qwen2.5-1.5b
# Sobrou um container de uma medição interrompida
docker rm -f fintrack-llm-medicao
```

| Situação                                        | O que fazer                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| "o sha256 ... não bate com o do Hugging Face"   | O download veio corrompido (o arquivo já foi apagado): rode de novo                              |
| "não achei o container fintrack-prod-web-1"     | A produção está no ar? `fintrack-status`. Para medir sem ela: `--sem-producao`                   |
| "a porta 8090 já está em uso"                   | Outra medição ficou no ar: `docker rm -f fintrack-llm-medicao`                                   |
| Muitos erros `URLError` ou `RemoteDisconnected` | O container morreu (memória?): `docker logs fintrack-llm-medicao` antes do fim; `LLM_MEMORIA=4g` |
| A produção ficou lenta durante a medição        | Ctrl+C (grava o que já mediu e derruba o container); o relatório mostra o impacto                |

## IA local (serviço `llm`, M10.2b, ADR-016)

O Qwen2.5 3B roda no llama-server, num container `llm` que só existe na janela da noite: o
timer `fintrack-llm-ligar` sobe às 04:40 e o `fintrack-llm-desligar` derruba às 06:45. Ele fica
numa rede interna (`llm`) que só o `ml` alcança; o app pergunta ao `ml`, nunca ao `llm`. A fila
`local-ai-nightly` do app trabalha das 04:45 às 06:40, até 200 recebidos por lar por noite, só no
que veio do banco (Meu Pluggy, OFX, PDF) e ficou sem categoria. Nada vale sem a pessoa confirmar;
categoria nova só com o "Criar e aplicar". Começa desligada em cada lar (Ajustes › Categorização).

```bash
# O que está instalado e se está no ar (e os timers)
sudo -u fintrack fintrack-llm estado
# A última noite (só contagens: com categoria, nova, nenhuma, barrada, inválida)
sudo -u fintrack fintrack-compose logs --since 30h --no-log-prefix web | jq -R 'fromjson? | select(.event? == "local_ai.night")'
# Prova, na configuração de produção, que a resposta sai no schema e o texto não vai para o log
sudo -u fintrack fintrack-llm testar
```

| Situação                                 | O que fazer                                                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `status: UNAVAILABLE` toda noite         | `systemctl list-timers 'fintrack-llm-*'`; `journalctl -u fintrack-llm-ligar --since yesterday`                 |
| "modelo ausente ou diferente do medido"  | `sudo -u fintrack fintrack-llm instalar` (baixa de novo e confere o sha256)                                    |
| "o llm não ficou pronto em 300s"         | `docker logs` do llm; memória? O container tem 3 GB. `LLM_ESPERA=600 fintrack-llm ligar` para ver de novo      |
| `testar` diz que o texto apareceu no log | Não ligue a IA em nenhum lar: `fintrack-llm desligar`, e registre o caso (o ADR-016 diz que isso não acontece) |
| O site ficou lento de madrugada          | Ele tem 2 CPUs com prioridade baixa (`cpu_shares` 256). Desligue a IA no lar ou pare os timers (abaixo)        |
| Parar a IA local sem derrubar nada       | `sudo systemctl disable --now fintrack-llm-ligar.timer`; `sudo -u fintrack fintrack-llm desligar`              |

Trocar o modelo, a imagem ou os argumentos é medir de novo (`services/ml/bench`, ADR-016).

## Bot do WhatsApp (M11, ADR-018)

O webhook `https://<seu domínio>/api/whatsapp/webhook` é a única rota pública do bot. Ele só confere
a assinatura da Meta, grava a mensagem (uma vez só) e põe na fila `bot-message`; a resposta sai pela
Cloud API. Sem as quatro variáveis `WHATSAPP_*` do painel da Meta em `/srv/fintrack/app.env`, o bot
está **desligado no servidor** e a rota responde 404 (o M11.1 vai para a produção assim; o M11.2
grava os valores). Desligar só no lar: Ajustes › Bot do WhatsApp.

```bash
# A rota (sem configuração: 404; com: 403 para um token de verificação errado)
curl -s -o /dev/null -w '%{http_code}\n' 'https://fintrack.SEU-DOMINIO/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1'
# O que o webhook recebeu e o que a fila fez (só contagens e o resultado)
sudo -u fintrack fintrack-compose logs --since 24h --no-log-prefix web | jq -R 'fromjson? | select((.event? // "") | startswith("webhook.") or startswith("bot."))'
# A conta das respostas grátis do mês (para em 900)
sudo -u fintrack fintrack-compose exec db psql -U fintrack -c \
  'SELECT month, used, "warnedAt" FROM bot_reply_count ORDER BY month DESC LIMIT 3'
```

| Situação                                       | O que fazer                                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `webhook.rejected` com `reason: signature`     | Alguém chamou sem a assinatura certa, ou a `WHATSAPP_APP_SECRET` não é a do app: confira no painel da Meta |
| O bot não responde e não há `webhook.received` | O webhook não chega: a Meta mostra o erro em WhatsApp › Configuração; confira o túnel e o caminho          |
| `bot.message` com `failed` maior que zero      | A Cloud API recusou a resposta (token vencido? `WHATSAPP_ACCESS_TOKEN` é o do usuário do sistema?)         |
| Chegou a 900 no mês                            | Esperado: o bot silencia até o dia 1º; os lançamentos continuam em Recebidos                               |
| Suspeita de número indevido                    | Ajustes › Bot do WhatsApp › Desvincular (cada pessoa o seu); ou desligue o bot do lar                      |

Trocar o `BETTER_AUTH_SECRET` desfaz os vínculos (o HMAC dos números deriva dele): cada pessoa
vincula de novo.

## Alertas

| Alerta                               | Significa                                   | Primeiro passo                                    |
| ------------------------------------ | ------------------------------------------- | ------------------------------------------------- |
| UptimeRobot: FinTrack fora do ar     | O `/api/health` público não respondeu ok    | Luz/internet de casa? Depois `fintrack-status`    |
| Healthchecks: backup diário atrasado | O backup das 03:30 não rodou ou falhou      | `journalctl -u fintrack-backup --since yesterday` |
| Healthchecks: deploy (falha)         | Um deploy falhou e a versão anterior voltou | "Um deploy falhou", acima                         |

## Disco cheio

```bash
df -h /
docker system df                                   # quanto as imagens e volumes ocupam
sudo -u fintrack docker image prune -f             # imagens sem etiqueta
du -sh /srv/fintrack/backups                       # os backups locais
```

Nunca apague o volume `fintrack-prod_db-data` e nunca use `fintrack-compose down -v`.
