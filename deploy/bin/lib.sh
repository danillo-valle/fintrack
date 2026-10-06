#!/usr/bin/env bash
# As variáveis definidas aqui são usadas pelos scripts que fazem source deste arquivo
# shellcheck disable=SC2034
# Funções comuns dos scripts de operação do FinTrack (deploy/bin). Não é executado sozinho:
# cada script faz "source" deste arquivo.
#
# Onde fica cada coisa no servidor (FINTRACK_HOME = /srv/fintrack; os testes usam outra pasta):
#   repo/                     clone do repositório PÚBLICO (só a pasta deploy/ é usada)
#   .env                      senha do banco e token do túnel     (600, fora do Git)
#   app.env                   variáveis do app                    (600, fora do Git)
#   operacao.env              backup, retenção, Healthchecks      (600, fora do Git)
#   compose.override.yml      (opcional) ajustes desta máquina    (fora do Git)
#   backup-recipient.txt      chave PÚBLICA do age (cifra os backups; não decifra)
#   backups/                  backups cifrados (*.dump.age)       (700)
#   estado/versao.env         FINTRACK_VERSION=<commit no ar>
#   estado/versao-anterior    o commit que estava no ar antes (para voltar)
#   estado/falhou             commit cujo deploy falhou (o update não tenta de novo)
#   estado/deploys.log        histórico: quando, qual commit, quanto tempo levou
#   estado/restauracoes.log   histórico dos testes de restauração

set -Eeuo pipefail

FINTRACK_HOME="${FINTRACK_HOME:-/srv/fintrack}"
REPO_DIR="$FINTRACK_HOME/repo"
STATE_DIR="$FINTRACK_HOME/estado"
BACKUP_DIR="$FINTRACK_HOME/backups"
COMPOSE_FILE="$REPO_DIR/deploy/compose.prod.yml"
# Imagens publicadas pelo CI (job "imagem" do ci.yml)
IMAGE_WEB="${IMAGE_WEB:-ghcr.io/danillo-valle/fintrack-web}"
IMAGE_MIGRATE="${IMAGE_MIGRATE:-ghcr.io/danillo-valle/fintrack-migrate}"
REPO_URL="${REPO_URL:-https://github.com/danillo-valle/fintrack.git}"

# Configurações de operação (retenção, Drive, Healthchecks), se o arquivo existir
if [ -f "$FINTRACK_HOME/operacao.env" ]; then
  # shellcheck disable=SC1091
  set -a && . "$FINTRACK_HOME/operacao.env" && set +a
fi

# ── Mensagens ────────────────────────────────────────────────────────────────────────────
# Uma linha por acontecimento, com data: vai para o journal (journalctl -u fintrack-update)
log()  { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
warn() { log "AVISO: $*" >&2; }
die()  { log "ERRO: $*" >&2; exit 1; }

# ── Docker Compose de produção ───────────────────────────────────────────────────────────
# Sempre o mesmo projeto, o mesmo arquivo e os mesmos arquivos de variáveis
compose() {
  local args=(-p fintrack-prod -f "$COMPOSE_FILE")
  # Personalização desta máquina, fora do Git (o apêndice da VPS usa para publicar as portas
  # 80 e 443 do Caddy). Sem o arquivo, vale só o compose.prod.yml.
  [ -f "$FINTRACK_HOME/compose.override.yml" ] && args+=(-f "$FINTRACK_HOME/compose.override.yml")
  args+=(--env-file "$FINTRACK_HOME/.env")
  [ -f "$STATE_DIR/versao.env" ] && args+=(--env-file "$STATE_DIR/versao.env")
  docker compose "${args[@]}" "$@"
}

# ── Versões ──────────────────────────────────────────────────────────────────────────────
is_commit() { [[ "${1:-}" =~ ^[0-9a-f]{40}$ ]]; }

current_version() {
  if [ -f "$STATE_DIR/versao.env" ]; then
    sed -n 's/^FINTRACK_VERSION=//p' "$STATE_DIR/versao.env"
  fi
}

write_version() {
  is_commit "$1" || die "versão inválida: $1"
  printf 'FINTRACK_VERSION=%s\n' "$1" > "$STATE_DIR/versao.env.tmp"
  mv "$STATE_DIR/versao.env.tmp" "$STATE_DIR/versao.env"
}

# Commit gravado na imagem (etiqueta OCI que o Dockerfile põe a partir do APP_VERSION)
image_revision() {
  docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$1" 2>/dev/null
}

# ── Um script por vez ────────────────────────────────────────────────────────────────────
# Deploy, update e backup não podem rodar juntos (um backup no meio de uma migração, por
# exemplo). flock segura um "cadeado" num arquivo; quem chega depois espera ou desiste.
take_lock() {
  local wait="${1:-0}"
  exec 9>"$STATE_DIR/.lock"
  if ! flock -w "$wait" 9; then
    log "outro script de operação está rodando; tente de novo em instantes"
    exit 0
  fi
}

# ── Healthchecks.io ──────────────────────────────────────────────────────────────────────
# ping URL [sufixo]   sufixo vazio = sucesso, "/fail" = falha, "/start" = começou
hc_ping() {
  local url="${1:-}" suffix="${2:-}"
  [ -n "$url" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "${url}${suffix}" || warn "não consegui avisar o Healthchecks"
}

# ── Saúde do app ─────────────────────────────────────────────────────────────────────────
# Pergunta ao app, de DENTRO do container (o app não publica porta), e imprime a resposta
app_health() {
  compose exec -T web node -e '
    fetch("http://127.0.0.1:3000/api/health")
      .then(async (r) => { process.stdout.write(await r.text()); process.exit(r.ok ? 0 : 1); })
      .catch(() => process.exit(2));
  ' 2>/dev/null
}

# Espera o app responder "ok" com a versão esperada (até $2 segundos)
wait_healthy() {
  local expected="$1" timeout="${2:-120}" waited=0 body
  while [ "$waited" -lt "$timeout" ]; do
    if body=$(app_health) && [[ "$body" == *'"status":"ok"'* ]] && [[ "$body" == *"\"version\":\"$expected\""* ]]; then
      return 0
    fi
    sleep 3
    waited=$((waited + 3))
  done
  warn "o app não respondeu ok na versão ${expected:0:7} em ${timeout}s; última resposta: ${body:-nenhuma}"
  return 1
}
