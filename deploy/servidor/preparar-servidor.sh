#!/usr/bin/env bash
# Prepara o servidor para a produção do FinTrack. Rode UMA vez, com sudo (pode repetir: ele
# pula o que já existe e nunca sobrescreve os seus arquivos de variáveis):
#
#   sudo bash deploy/servidor/preparar-servidor.sh
#
# O que ele faz:
#   1. instala age (cifra os backups), rclone (cópia no Google Drive), git e jq, se faltarem
#   2. cria o usuário de sistema "fintrack" (sem senha, sem login), dono de /srv/fintrack
#   3. clona o repositório PÚBLICO em /srv/fintrack/repo, só com deploy/ e as migrações
#   4. copia os modelos de variáveis (.env, app.env, operacao.env) com permissão 600
#   5. instala os atalhos fintrack-* em /usr/local/bin e as unidades do systemd
#
# Ele NÃO liga os timers nem sobe nada: isso fica para quando as variáveis estiverem preenchidas.
set -Eeuo pipefail

[ "$(id -u)" = 0 ] || { echo "Rode com sudo: sudo bash $0"; exit 1; }

HOME_DIR=/srv/fintrack
REPO_URL="${REPO_URL:-https://github.com/danillo-valle/fintrack.git}"
BRANCH="${BRANCH:-main}"
say() { printf '\033[1m==>\033[0m %s\n' "$*"; }

say "1/5 Pacotes: age, rclone, git, jq"
command -v docker >/dev/null || { echo "Docker não encontrado (instalado no M00?)"; exit 1; }
missing=()
for pkg in age rclone git jq; do command -v "$pkg" >/dev/null || missing+=("$pkg"); done
if [ "${#missing[@]}" -gt 0 ]; then
  apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${missing[@]}"
fi

say "2/5 Usuário fintrack e pastas"
if ! id fintrack >/dev/null 2>&1; then
  # --system: usuário de serviço; nologin: ninguém entra como ele por SSH
  useradd --system --home-dir "$HOME_DIR" --create-home --shell /usr/sbin/nologin fintrack
fi
# No grupo docker, o fintrack controla os containers. Atenção: o grupo docker equivale a root
# na máquina (quem manda no Docker monta qualquer pasta). Por isso o usuário não tem login.
usermod -aG docker fintrack
install -d -o fintrack -g fintrack -m 750 "$HOME_DIR"
install -d -o fintrack -g fintrack -m 700 "$HOME_DIR/estado" "$HOME_DIR/backups"

say "3/5 Repositório (só deploy/ e as migrações) em $HOME_DIR/repo"
if [ ! -d "$HOME_DIR/repo/.git" ]; then
  sudo -u fintrack git clone -q --depth 1 --filter=blob:none --sparse --branch "$BRANCH" "$REPO_URL" "$HOME_DIR/repo"
fi
sudo -u fintrack git -C "$HOME_DIR/repo" sparse-checkout set deploy packages/db/prisma/migrations
[ -x "$HOME_DIR/repo/deploy/bin/fintrack-deploy" ] || { echo "deploy/bin não veio no clone: o M05 já está na $BRANCH?"; exit 1; }

say "4/5 Arquivos de variáveis (modelos; você preenche no próximo passo do manual)"
for pair in "compose.env.example:.env" "app.env.example:app.env" "operacao.env.example:operacao.env"; do
  src="$HOME_DIR/repo/deploy/env/${pair%%:*}" dst="$HOME_DIR/${pair##*:}"
  if [ -e "$dst" ]; then
    echo "    $dst já existe: mantido"
  else
    install -o fintrack -g fintrack -m 600 "$src" "$dst"
    echo "    $dst criado a partir do modelo"
  fi
done

say "5/5 Atalhos e unidades do systemd"
for cmd in fintrack-compose fintrack-status fintrack-definir fintrack-deploy fintrack-backup fintrack-restore-test fintrack-restore-prod; do
  ln -sfn "$HOME_DIR/repo/deploy/bin/$cmd" "/usr/local/bin/$cmd"
done
# As unidades são COPIADAS (e não ligadas ao repo): um commit novo não muda o que roda como
# serviço sem você ver. Ao mudar uma unidade, rode este script de novo.
install -m 644 "$HOME_DIR"/repo/deploy/systemd/fintrack-*.service "$HOME_DIR"/repo/deploy/systemd/fintrack-*.timer /etc/systemd/system/
systemctl daemon-reload

say "Pronto. Próximos passos no manual: preencher $HOME_DIR/.env e $HOME_DIR/app.env."
