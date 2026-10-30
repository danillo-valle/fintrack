#!/usr/bin/env bash
# Varredura ATIVA do ZAP numa cópia local descartável do FinTrack (M12.4, OWASP Top 10, ADR-024).
#
#   bash scripts/zap/copia-local.sh                 a imagem da main (:main), 30 min por rodada
#   ZAP_ATIVO_MINUTOS=60 bash scripts/zap/copia-local.sh
#
# O que faz, nesta ordem:
#   1. sobe a cópia (scripts/zap/compose.copia.yml): banco vazio em memória, Mailpit e o app da
#      imagem publicada, só no 127.0.0.1 desta máquina (porta 3100)
#   2. aplica as migrações, cria a conta de TESTE pelo caminho de verdade (cadastro, e-mail, 2FA)
#      e grava os dados sintéticos do seed na casa dela
#   3. roda a varredura ativa duas vezes (sem sessão e com a sessão de teste), pelo varrer.sh
#   4. conta os erros do app durante a varredura (request.error no log da cópia): o ZAP não acusa
#      um erro 500 que não mostra detalhe, mas um pedido estranho que derruba uma tela é um defeito
#      (foi assim que o caractere nulo na busca apareceu no M12.4a)
#   5. apaga a cópia inteira (contêineres, rede e banco), aconteça o que acontecer
#
# A produção não é tocada: outro projeto do Docker, outra rede, nenhum volume, nenhuma variável
# dela. Os relatórios ficam em relatorios-zap-ativo/ (fora do Git, como o relatorios-zap/).
#
# Saída: 0 = nenhum alerta de risco Baixo ou maior nas duas rodadas e nenhum erro do app; 1 = algum
# alerta ou erro (o resumo, os relatórios e o erros-do-app.txt dizem qual); 2 = a cópia ou o ZAP
# falharam.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
reports="$root/relatorios-zap-ativo"
url="http://localhost:3100"

work="$(mktemp -d)"
chmod 700 "$work"
ZAP_SEGREDO="$(openssl rand -base64 32)"
export ZAP_SEGREDO FINTRACK_VERSION="${FINTRACK_VERSION:-main}"
copia() { docker compose -p fintrack-zap -f "$here/compose.copia.yml" "$@"; }
# shellcheck disable=SC2329  # chamada pelo trap
cleanup() {
  copia --profile tarefas down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

say() { printf '\ncopia-local: %s\n' "$*"; }

say "1/5 subindo a cópia descartável (imagem $FINTRACK_VERSION)"
copia --profile tarefas pull --quiet migrate web
copia up -d db mail
copia --profile tarefas run --rm migrate >/dev/null
copia up -d web
for _ in $(seq 1 60); do
  curl -fsS "$url/api/health" 2>/dev/null | grep -q '"status":"ok"' && break
  sleep 2
done
curl -fsS "$url/api/health" | grep -q '"status":"ok"' || { echo "copia-local: o app não respondeu" >&2; exit 2; }

say "2/5 conta de teste e dados sintéticos"
node "$here/conta-de-teste.mjs" --url "$url" --mailpit http://localhost:3125 \
  --email zap@fintrack.test --saida "$work/cookie"
copia --profile tarefas run --rm -e SEED_VIEWER_EMAIL=zap@fintrack.test -e SEED_TARGET_HOST=db \
  migrate prisma db seed >/dev/null

say "3/5 varredura ativa (até ${ZAP_ATIVO_MINUTOS:-30} min por rodada)"
status=0
ZAP_MODO=ativo bash "$here/varrer.sh" "$url" "$reports" || status=$?
logged=0
ZAP_MODO=ativo bash "$here/varrer.sh" "$url" "$reports" "$work/cookie" || logged=$?
[ "$logged" -gt "$status" ] && status=$logged

say "4/5 erros do app durante a varredura"
# Só o evento e o caminho (sem a query, como o app grava): nenhum dado do pedido
copia logs --no-color --no-log-prefix web 2>/dev/null | python3 -c '
import collections, json, sys
paths = collections.Counter()
for line in sys.stdin:
    try:
        entry = json.loads(line)
    except ValueError:
        continue
    if isinstance(entry, dict) and entry.get("event") == "request.error":
        paths[str(entry.get("path", "?"))] += 1
for path, count in paths.most_common():
    print(f"{count:6} {path}")
' > "$reports/erros-do-app.txt"
if [ -s "$reports/erros-do-app.txt" ]; then
  echo "copia-local: o app respondeu com erro durante a varredura (vezes e caminho):"
  head -n 20 "$reports/erros-do-app.txt"
  [ "$status" -ge 1 ] || status=1
else
  echo "  nenhum erro do app"
fi

say "5/5 apagando a cópia (o trap faz no fim, aconteça o que acontecer)"
case "$status" in
  0) echo "copia-local: OK, nenhum alerta de risco Baixo ou maior e nenhum erro do app (relatórios em $reports)" ;;
  1) echo "copia-local: há alertas ou erros do app (veja o resumo acima e $reports)" ;;
  *) echo "copia-local: o ZAP não terminou (saída $status)" >&2 ;;
esac
exit "$status"
