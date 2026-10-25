#!/usr/bin/env bash
# Varredura PASSIVA do ZAP contra um FinTrack já no ar (M12.1). Roda o plano scripts/zap/plano.yaml
# e resume os alertas no fim. O CI roda contra a imagem de produção; dá para rodar igual no seu
# servidor contra o "pnpm dev" ou uma imagem local.
#
#   bash scripts/zap/varrer.sh http://localhost:3000 relatorios-zap            # público
#   bash scripts/zap/varrer.sh http://localhost:3000 relatorios-zap cookie.txt # logado
#
# O 3º argumento é o arquivo com o cabeçalho Cookie da conta de TESTE (conta-de-teste.mjs). Ele
# entra no ZAP só por variável de ambiente (nunca na linha de comando, que aparece no "ps") e o
# ZAP o manda só para o endereço varrido.
#
# Saída: 0 = nenhum alerta de risco Baixo ou maior (fora as exceções do plano); 1 = algum alerta
# (o resumo diz qual); 2 = o próprio ZAP falhou. Os relatórios (HTML e JSON) ficam na pasta.
#
# Por padrão usa a imagem oficial do ZAP com a versão fixa. ZAP_SH=/caminho/zap.sh usa um ZAP
# instalado na máquina (o laboratório, sem Docker).
set -euo pipefail

ZAP_IMAGE="${ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy:2.17.0}"
here="$(cd "$(dirname "$0")" && pwd)"

if [ $# -lt 2 ]; then
  echo "uso: bash scripts/zap/varrer.sh <endereço> <pasta-dos-relatórios> [arquivo-do-cookie]" >&2
  exit 2
fi
target="${1%/}"
reports="$2"
cookie_file="${3:-}"

case "$target" in
  http://* | https://*) ;;
  *)
    echo "varrer: o endereço precisa começar com http:// ou https:// ($target)" >&2
    exit 2
    ;;
esac
host="$(printf '%s' "$target" | sed -E 's#^https?://([^/:]+).*#\1#')"

name=publico
if [ -n "$cookie_file" ]; then
  name=logado
  [ -s "$cookie_file" ] || {
    echo "varrer: arquivo do cookie vazio ou ausente ($cookie_file)" >&2
    exit 2
  }
  # Só pela variável de ambiente; o ZAP manda o cabeçalho a todo pedido para esse host
  ZAP_AUTH_HEADER_VALUE="$(cat "$cookie_file")"
  export ZAP_AUTH_HEADER_VALUE
  export ZAP_AUTH_HEADER=Cookie
  export ZAP_AUTH_HEADER_SITE="$host"
fi

mkdir -p "$reports"
reports="$(cd "$reports" && pwd)"
export ZAP_ALVO="$target" ZAP_NOME="$name"

echo "varrer: $name em $target (relatórios em $reports)"
set +e
if [ -n "${ZAP_SH:-}" ]; then
  home="$(mktemp -d)"
  ZAP_RELATORIOS="$reports" "$ZAP_SH" -cmd -silent -dir "$home" -autorun "$here/plano.yaml"
  status=$?
  rm -rf "$home"
else
  # O ZAP da imagem roda como o usuário "zap": a pasta dos relatórios precisa aceitar gravação
  chmod a+rwx "$reports"
  docker run --rm --network host \
    -v "$here:/zap/plano:ro" -v "$reports:/zap/wrk:rw" \
    -e ZAP_ALVO -e ZAP_NOME -e ZAP_RELATORIOS=/zap/wrk \
    ${cookie_file:+-e ZAP_AUTH_HEADER -e ZAP_AUTH_HEADER_VALUE -e ZAP_AUTH_HEADER_SITE} \
    "$ZAP_IMAGE" zap.sh -cmd -silent -autorun /zap/plano/plano.yaml
  status=$?
fi
set -e

# O resumo: um alerta por linha (risco, regra, nome, quantas vezes). As exceções do plano
# aparecem como "Falso positivo"
json="$reports/zap-$name.json"
if [ ! -s "$json" ]; then
  echo "varrer: o ZAP não gerou o relatório $json (saída $status)" >&2
  exit 2
fi
python3 - "$json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
rows = [
    (alert["riskdesc"], alert["pluginid"], alert["name"], alert["count"])
    for site in data.get("site", [])
    for alert in site.get("alerts", [])
]
order = {"High": 0, "Medium": 1, "Low": 2, "Informational": 3}
rows.sort(key=lambda r: order.get(r[0].split(" ")[0], 9))
print("varrer: alertas (risco (confiança) | regra | nome | ocorrências)")
for risk, rule, title, count in rows:
    print(f"  {risk:<26} {rule:<6} {title} ({count})")
if not rows:
    print("  nenhum")
PY

case "$status" in
  0) echo "varrer: $name OK (nenhum alerta de risco Baixo ou maior)" ;;
  1) echo "varrer: $name FALHOU: há alerta de risco Baixo ou maior (veja acima e o relatório)" ;;
  *)
    echo "varrer: o ZAP não terminou (saída $status)" >&2
    exit 2
    ;;
esac
exit "$status"
