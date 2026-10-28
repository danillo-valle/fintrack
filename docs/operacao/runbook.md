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
grava os valores). Desligar só no lar: Ajustes › Bot de lançamento.

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
| `bot.message` com `failed` maior que zero      | A Cloud API recusou: o `bot.send_failed` logo antes traz o código (tabela abaixo)                          |
| Chegou a 900 no mês                            | Esperado: o bot silencia até o dia 1º; os lançamentos continuam em Recebidos                               |
| Suspeita de número indevido                    | Ajustes › Bot de lançamento › Desvincular (cada pessoa o seu); ou desligue o bot do lar                    |

Trocar o `BETTER_AUTH_SECRET` desfaz os vínculos (o HMAC dos números deriva dele): cada pessoa
vincula de novo.

### A Meta (M11.2 e M12.0): o número, o token e os códigos de erro

Em produção o bot usa um **número de produção** (Etapa 2 do caso de uso "Conectar no WhatsApp"),
com o app em modo de desenvolvimento: sem lista de autorizados, e o bot só **responde** (mensagens
de serviço, 1.000 grátis por mês; o FinTrack para em 900). O número de teste (+1 555, lista de até 5)
continua possível (`WHATSAPP_TEST_NUMBER=on`). Regras que não se negociam:

- **Nenhuma forma de pagamento** no portfólio ou na conta: sem ela, a Meta para de entregar o que
  passa do grátis, em vez de cobrar.
- **Nenhum template**: template é sempre cobrado e o bot nunca inicia conversa.
- **Crie o app já dentro do portfólio** (a etapa "Empresa" da criação). Um app sem portfólio deixa o
  "Reivindicar número de teste" falhando, e cada tentativa cria uma conta presa que ocupa o limite do
  portfólio ("número máximo de contas do WhatsApp Business", #2494067). Uma tentativa só.
- **A conta do WhatsApp assinada no app** (`subscribed_apps`, abaixo): sem isso, a verificação e o
  "Testar" do painel funcionam, mas nenhuma mensagem real chega.

Onde fica cada coisa no painel (developers.facebook.com › Meus apps):

| O quê                 | Onde                                                                                  | Variável                   |
| --------------------- | ------------------------------------------------------------------------------------- | -------------------------- |
| Chave secreta do app  | Configurações do app › Básico › Chave secreta do app                                  | `WHATSAPP_APP_SECRET`      |
| Id do número          | Casos de uso › WhatsApp › Configuração da API › "Identificação do número de telefone" | `WHATSAPP_PHONE_NUMBER_ID` |
| Lista de quem recebe  | Só no número de teste: Configuração da API › Para › "Gerenciar lista"                 |                            |
| Webhook (URL e token) | Casos de uso › WhatsApp › Configuração › Webhook; campo assinado: **messages**        | `WHATSAPP_VERIFY_TOKEN`    |
| Token permanente      | Configurações do negócio › Usuários do sistema › Gerar token (validade: Nunca)        | `WHATSAPP_ACCESS_TOKEN`    |

```bash
# A Meta recusou alguma resposta? (só o código; nunca o número)
sudo -u fintrack fintrack-compose logs --since 24h --no-log-prefix web | jq -R -c 'fromjson? | select(.event? == "bot.send_failed") | {time, kind, status, code, subcode, hint}'
```

| Código (`hint`)                           | O que é                                                                                                   | O que fazer                                                                                                                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 131030 (`fora_da_lista_de_teste`)         | Quem recebe não está na lista do número de teste                                                          | Cadastre o número na lista. DDD fora de 11–19, 21, 22, 24, 27, 28 (o 41, por exemplo): cadastre também sem o 9                                                               |
| 190 (`token_invalido`)                    | Token vencido ou revogado (o da página API Setup dura 24 h)                                               | Gere o token do usuário do sistema (Nunca) e grave com o `fintrack-definir`; reinicie o `web`                                                                                |
| 100 (`parametro_invalido`)                | Em geral, o número no lugar do **id** do número                                                           | `WHATSAPP_PHONE_NUMBER_ID` é o id (15 a 17 dígitos) da Configuração da API                                                                                                   |
| 131047 (`fora_da_janela_24h`)             | Passou de 24 h desde a mensagem da pessoa                                                                 | Esperado em botão antigo: a pessoa manda uma mensagem nova (o bot nunca usa template, que é cobrado)                                                                         |
| 131037 (`nome_de_exibicao_sem_aprovacao`) | Número **fornecido pela Meta** com o nome de exibição não aprovado (`AVAILABLE_WITHOUT_REVIEW` não basta) | Consulte o estado (abaixo); peça a revisão do nome (`new_display_name`); aprovado, registre o número de novo com o PIN (em até 14 dias). Sem revisão aberta: suporte da Meta |
| 131026 (`nao_entregue`)                   | A pessoa não pode receber (bloqueou, app antigo)                                                          | Confira no celular dela                                                                                                                                                      |
| 130429 / 131056 (`limite_de_envio`…)      | Muitas mensagens em pouco tempo                                                                           | Espere alguns minutos                                                                                                                                                        |

O estado do número, direto da Meta (o token sai do `app.env` sem as aspas e vai ao `curl` pela entrada,
nunca na linha de comando):

```bash
sudo -u fintrack grep '^WHATSAPP_ACCESS_TOKEN=' /srv/fintrack/app.env | cut -d= -f2- \
  | sed -e "s/^[\"']//" -e "s/[\"']\$//" \
  | sed 's/^/header = "Authorization: Bearer /; s/$/"/' \
  | curl -s -K - "https://graph.facebook.com/v26.0/<id do número>?fields=verified_name,name_status,new_display_name,new_name_status,status,health_status" \
  | jq .
```

- `health_status.entities[].errors` e `additional_info` dizem o que a Meta está bloqueando. 141006 (forma
  de pagamento) só trava conversa iniciada pela empresa (template): o bot só responde, ignore; 141010
  (empresa não verificada) limita o volume; 138024/138025 (SIP) são de chamadas, irrelevantes.
- O nome: `POST <id do número>?new_display_name=<nome>` pede a revisão (10 trocas por 30 dias; o mesmo
  nome não abre revisão). Depois de `APPROVED`, `POST <id do número>/register` com
  `{"messaging_product":"whatsapp","pin":"<6 dígitos>"}`. Sem o PIN: `POST <id do número>` com
  `{"pin":"<6 dígitos novos>"}` define outro (guarde no gerenciador de senhas).

| Situação                                                                    | O que fazer                                                                                                                                                          |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Não foi possível validar a URL" ao salvar o webhook na Meta                | O `WHATSAPP_VERIFY_TOKEN` do `app.env` é o mesmo do painel? O `web` foi reiniciado depois de gravar? `curl` da rota responde 403 (e não 404)?                        |
| A verificação passa, mas nenhum `webhook.received` chega                    | Campo **messages** assinado? A conta assinada no app (`subscribed_apps`, abaixo)? Cloudflare › Segurança › Bots: o "Bot Fight Mode" barra o POST da Meta (desligue)  |
| O "Testar" do painel chega (`webhook.received`), mas as mensagens reais não | Falta assinar a conta no app: Explorador da Graph API, `GET <id da conta>/subscribed_apps`; vazio = `POST` na mesma consulta, uma vez (`{"success": true}`)          |
| "Reivindicar número de teste" falha ("erro ao criar a conta de teste")      | Não insista: cada clique cria uma conta presa. Confira que o app foi criado dentro do portfólio; se o limite encheu, só o suporte da Meta limpa                      |
| Trocar o token permanente                                                   | Gere outro no usuário do sistema; `sudo -u fintrack fintrack-definir app.env WHATSAPP_ACCESS_TOKEN`; `sudo -u fintrack fintrack-compose up -d web`; revogue o antigo |
| Trocar a chave secreta do app                                               | Painel da Meta › Básico › Redefinir; grave a nova com o `fintrack-definir` e reinicie o `web` (até lá, todo POST é recusado como assinatura errada)                  |
| Trocar a versão da Graph API (a `v26.0` vence ~2 anos depois de 29/7/2026)  | No repositório: o padrão do `WHATSAPP_API_URL` no `env.ts`, o `.env.example` e o `playwright.config.ts` (skill `bot-whatsapp`)                                       |

## Bot do Telegram (M12.0b, ADR-019)

O webhook `https://<seu domínio>/api/telegram/webhook` é a única rota pública do Telegram. Ele só
confere o segredo do cabeçalho `X-Telegram-Bot-Api-Secret-Token` (o mesmo do `setWebhook`), grava a
mensagem (uma vez só) e põe na mesma fila `bot-message`; a resposta sai pela Bot API. Sem as três
variáveis `TELEGRAM_*` em `/srv/fintrack/app.env`, o Telegram está **desligado no servidor** e a
rota responde 404. Sem teto de respostas (a conta das grátis é só do WhatsApp).

```bash
# A rota (sem configuração: 404; com: 200 "ok" para tudo, até sem o segredo)
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -d '{}' https://fintrack.SEU-DOMINIO/api/telegram/webhook
# O que o Telegram diz do webhook (o token sai do app.env sem as aspas e vai ao curl pela entrada)
sudo -u fintrack grep '^TELEGRAM_BOT_TOKEN=' /srv/fintrack/app.env | cut -d= -f2- \
  | sed -e "s/^[\"']//" -e "s/[\"']\$//" \
  | sed 's|^|url = "https://api.telegram.org/bot|; s|$|/getWebhookInfo"|' \
  | curl -s -K - | jq '.result | {url, pending_update_count, last_error_date, last_error_message, allowed_updates}'
# O que chegou e o que a fila fez, só do Telegram
sudo -u fintrack fintrack-compose logs --since 24h --no-log-prefix web | jq -R -c 'fromjson? | select(.channel? == "telegram") | {time, event, reason, outcome, sent, failed, code, hint}'
```

| Situação                                                   | O que fazer                                                                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `webhook.rejected` com `reason: secret`                    | Alguém chamou sem o segredo, ou o `TELEGRAM_WEBHOOK_SECRET` do `app.env` não é o do `setWebhook`: refaça o `setWebhook` com o segredo do `app.env` (manual M12.0b) |
| O bot não responde e não há `webhook.received` do Telegram | `getWebhookInfo` (acima): `url` vazia = falta o `setWebhook`; `last_error_message` diz o que o Telegram viu (túnel, certificado, 404)                              |
| `bot.send_failed` com `hint: bloqueado_pela_pessoa`        | A pessoa bloqueou o bot no Telegram; ela desbloqueia, ou desvincula em Ajustes                                                                                     |
| `bot.send_failed` com `hint: token_invalido`               | O token foi trocado no @BotFather (`/revoke`): grave o novo com o `fintrack-definir`, reinicie o `web` e refaça o `setWebhook`                                     |
| Vazou o token do bot                                       | @BotFather › `/revoke` (o antigo para na hora) → o novo pelo `fintrack-definir` → `fintrack-compose up -d web` → `setWebhook` de novo                              |
| Suspeita de conta indevida                                 | Ajustes › Bot de lançamento › Telegram › Desvincular (cada pessoa a sua); ou desligue o bot do lar                                                                 |

| Código (`hint`)                 | O que é                                              |
| ------------------------------- | ---------------------------------------------------- |
| 400 (`mensagem_igual`)          | O mesmo botão tocado duas vezes: o canal ignora      |
| 400 (`mensagem_nao_encontrada`) | A mensagem do botão foi apagada: o canal manda outra |
| 400 (`toque_vencido`)           | O toque ficou na fila mais de alguns minutos         |
| 403 (`bloqueado_pela_pessoa`)   | A pessoa bloqueou o bot                              |
| 400 (`conversa_nao_encontrada`) | A conta foi apagada ou nunca falou com o bot         |
| 401 (`token_invalido`)          | Token trocado ou revogado no @BotFather              |
| 429 (`limite_de_envio`)         | Muitas mensagens em pouco tempo: espere              |

## Segurança (M12.1, ADR-020)

O que cada item do OWASP Top 10 tem no FinTrack e as pendências: `docs/seguranca/owasp-top10-2025.md`.

### Eventos de segurança

O `fintrack-status` mostra, na seção "Segurança (últimas 24 h)", quantas vezes cada evento
apareceu no log do app:

| Evento                            | Significa                                                                                            | Normal                     | Agir quando                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------ |
| `auth.failed`                     | Senha, código do 2FA, código de backup, passkey ou link recusado                                     | Alguns por dia (digitação) | Dezenas num dia, ou o mesmo IP em sequência: veja o IP abaixo                  |
| `auth.rate_limited`               | O limite de tentativas barrou alguém (429)                                                           | Raro                       | Qualquer um que não foi você: alguém tentou muitas vezes seguidas              |
| `auth.origin_rejected`            | Pedido ao login vindo de outro site, ou sem origem                                                   | Zero                       | Qualquer um: um site tentou agir em nome de quem estava logado                 |
| `access.denied`                   | Alguém logado tentou abrir um recurso que não é dele                                                 | Zero                       | Qualquer um: veja o caminho e quem foi                                         |
| `auth.password_check_unavailable` | A consulta de senhas vazadas não respondeu em 3 s; a senha foi recusada com "tente de novo" (M12.3a) | Zero                       | Vários seguidos: o servidor não alcança o api.pwnedpasswords.com (veja abaixo) |
| `webhook.rejected`                | Webhook com assinatura ou segredo errado                                                             | Zero ou poucos             | Muitos: alguém está chamando o webhook por fora                                |

```bash
# Os eventos de segurança das últimas 24 h, com o IP (nunca há senha, e-mail ou código no log)
sudo -u fintrack fintrack-compose logs --since 24h --no-log-prefix web \
  | jq -R 'fromjson? | select((.event // "") | test("^auth\\.|^access\\.denied|^webhook\\.rejected")) | {time, event, path, code, ip}'

# Quem mais errou o login (IP e quantas vezes)
sudo -u fintrack fintrack-compose logs --since 24h --no-log-prefix web \
  | jq -rR 'fromjson? | select(.event == "auth.failed") | .ip' | sort | uniq -c | sort -rn | head
```

`auth.password_check_unavailable` seguidos: ninguém consegue criar conta, trocar ou redefinir a
senha até o servidor voltar a falar com o HIBP. Confira de dentro do container:
`sudo -u fintrack fintrack-compose exec web node -e "fetch('https://api.pwnedpasswords.com/range/21BD1',{signal:AbortSignal.timeout(3000)}).then(r=>console.log(r.status)).catch(e=>console.log(e.name))"`.
`200` = o serviço voltou; `TimeoutError` ou `TypeError` = rede ou DNS do servidor (o túnel não
importa aqui: é tráfego de saída). Status do serviço: https://haveibeenpwned.com.

Tentativas em sequência de um IP que não é seu: o limite de tentativas já barra (5 por minuto no
login e no 2FA), e sem o código do 2FA a senha sozinha não entra. Se continuar por horas, troque a
senha da conta visada (a troca derruba as sessões) e, na Cloudflare, bloqueie o IP em Security ›
WAF › Tools (grátis).

### O CI barrou o PR por causa do ZAP

O passo "Varredura do ZAP…" do job `imagem` lista os alertas no fim (`varrer: alertas`). O
relatório inteiro, com cada endereço e a evidência, está no artefato `relatorios-zap` do job.

1. Alerta novo depois de uma mudança sua: corrija na causa (um cabeçalho, um cookie, uma tela que
   vaza informação). É o caso comum.
2. Alerta que não se aplica ao FinTrack: só com a prova de que a proteção existe por outro caminho
   (de preferência um teste), acrescente a exceção em `scripts/zap/plano.yaml` (job
   `alertFilter`), com o motivo, e a linha na tabela "Exceções em vigor" do documento do OWASP.

Rodar a mesma varredura no seu servidor exige o **build de produção**: o `pnpm dev` tem a CSP de
desenvolvimento, mais aberta (o Next.js põe o CSS das telas em `<style>`), e o ZAP acusaria. Com o
`pnpm db:up` no ar e a porta 3000 livre (o Docker baixa a imagem do ZAP na 1ª vez, cerca de 1,5 GB):

```bash
docker build --target web -t fintrack-web:local .                     # a imagem, como no CI
set -a; . ./.env; set +a                                               # o DATABASE_URL e o e-mail do .env
docker run -d --rm --name fintrack-zap --network host \
  -e DATABASE_URL -e EMAIL_FROM -e SMTP_HOST -e SMTP_PORT -e ALLOWED_EMAILS \
  -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" -e BETTER_AUTH_URL=http://localhost:3000 \
  -e HIBP_CHECK=off fintrack-web:local                                 # o app de produção na porta 3000
bash scripts/zap/varrer.sh http://localhost:3000 relatorios-zap        # a rodada sem sessão
docker stop fintrack-zap                                               # para o app de teste
```

A rodada logada é a do CI (conta de teste e seed num banco limpo); para repetir em casa, siga os
passos do job `imagem` no `ci.yml`.

### O CI barrou o PR por causa do OSV-Scanner

O passo "Nenhuma dependência com vulnerabilidade conhecida" mostra uma tabela com o pacote, a
versão e o alerta. Quase sempre a correção é atualizar, numa branch própria:

```bash
pnpm update -r <pacote>                        # npm: a versão corrigida dentro da faixa
pnpm why <pacote>                              # se não mudou: quem pede a versão antiga
cd services/ml && uv lock --upgrade-package <pacote> && cd ../..   # Python
```

Se o pai prende a versão antiga, atualize o pai. Só quando não houver versão corrigida
alcançável e o código vulnerável não rodar no FinTrack, a exceção vai no `osv-scanner.toml`
(o próprio arquivo mostra o formato: pacote, versão, motivo e prazo).

## Testes de ponta a ponta no CI (M12.2, ADR-021)

O E2E do CI roda contra o **build de produção** em 3 partes ao mesmo tempo, mais o job `e2e-dev`
(o catálogo `/dev/ui`, que só existe no `pnpm dev`) e o `integracao` (o banco). O check `e2e`, o que
o ruleset exige, junta os relatórios e só fica verde com todos verdes.

### O CI barrou o PR por causa do E2E

1. Veja qual job falhou: `gh pr checks` (`e2e (parte N de 3)`, `e2e-dev`, `integracao` ou
   `e2e-build`). O job `e2e` só repete o resultado deles.
2. Baixe o relatório juntado (ele existe mesmo quando tudo passou):

```bash
RUN=$(gh run list --branch "$(git branch --show-current)" --workflow ci.yml --limit 1 --json databaseId --jq '.[0].databaseId')
rm -rf relatorio-playwright && gh run download "$RUN" -n relatorio-playwright -D relatorio-playwright
pnpm --filter @fintrack/web exec playwright show-report ../../relatorio-playwright   # abre no navegador
```

3. Cada falha tem o **trace** da primeira tentativa (a aba "Traces"): a tela a cada passo, os
   pedidos com o status e o console. Um teste marcado **flaky** falhou e passou na repetição: o PR
   segue, mas o trace mostra a corrida, e ela se corrige como qualquer falha (skill `teste-e2e`).
4. Para repetir em casa contra o mesmo tipo de build:

```bash
pnpm e2e:producao                                                            # build + suíte inteira
PLAYWRIGHT_PRODUCTION=1 pnpm --filter @fintrack/web exec playwright test e2e/<arquivo>.spec.ts --trace=retain-on-failure --output=test-results/<nome>
```

O segundo comando reaproveita o último build; o servidor avisa ("AVISO: há arquivos em
apps/web/src mais novos") quando o código mudou depois dele.

5. Para ver se uma falha é instável, repita o mesmo teste várias vezes **um de cada vez**:
   `--repeat-each=10 --workers=1`. Sem o `--workers=1`, as cópias rodam juntas e, como cada teste usa
   a mesma pessoa de teste em todas as cópias, uma apaga a pessoa da outra (`user_email_key`).

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
