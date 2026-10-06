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

| Segredo               | Como trocar                                                                                                                                                                                                               | Efeito colateral                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Token do túnel        | Painel Zero Trust → o túnel → **Refresh token**; `sudo -u fintrack fintrack-definir .env TUNNEL_TOKEN`; `sudo -u fintrack fintrack-compose up -d cloudflared`                                                             | Alguns segundos fora do ar                                                              |
| Chave do Resend       | Crie outra (só envio, só o domínio); `sudo -u fintrack fintrack-definir app.env SMTP_PASSWORD`; `sudo -u fintrack fintrack-compose up -d web`; apague a antiga no Resend                                                  | Nenhum                                                                                  |
| Senha do banco        | `sudo -u fintrack fintrack-compose exec db psql -U fintrack -c "\password fintrack"` (digite a nova); `sudo -u fintrack fintrack-definir .env POSTGRES_PASSWORD` (a mesma); `sudo -u fintrack fintrack-compose up -d web` | Alguns segundos fora do ar                                                              |
| `BETTER_AUTH_SECRET`  | `sudo -u fintrack fintrack-definir app.env BETTER_AUTH_SECRET --gerar-base64 32`; `sudo -u fintrack fintrack-compose up -d web`                                                                                           | **Todas as sessões caem e o 2FA precisa ser refeito**                                   |
| Chave do backup (age) | `age-keygen` novo; guarde a privada; troque o `backup-recipient.txt`                                                                                                                                                      | Backups antigos continuam precisando da chave ANTIGA: guarde as duas até eles expirarem |

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
