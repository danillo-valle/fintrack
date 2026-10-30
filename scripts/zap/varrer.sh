#!/usr/bin/env bash
# Varredura do ZAP contra um FinTrack já no ar. Roda o plano scripts/zap/plano.yaml e resume os
# alertas no fim. PASSIVA por padrão (M12.1): o CI roda contra a imagem de produção; dá para rodar
# igual no seu servidor contra o "pnpm dev" ou uma imagem local.
#
# ATIVA com ZAP_MODO=ativo (M12.4): o ZAP também ATACA cada pedido (o job do scripts/zap/ativo.yaml
# entra no plano). Grava e apaga dados, então só aceita um endereço local (127.0.0.1 ou
# localhost); quem sobe a cópia descartável e chama este script é o scripts/zap/copia-local.sh.
# ZAP_ATIVO_MINUTOS (padrão 30) é o teto de cada rodada.
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
#
# Enquanto o ZAP trabalha, uma linha por minuto diz há quanto tempo a rodada está no ar (M12.4b): a
# varredura ativa passa até 30 minutos sem nenhuma saída do ZAP, e um terminal calado parece travado.
# ZAP_PROGRESSO_SEGUNDOS troca o intervalo (os testes usam 1).
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

mode="${ZAP_MODO:-passivo}"
case "$mode" in
  passivo) suffix="" ;;
  ativo)
    suffix="-ativo"
    # A varredura ativa ataca de verdade: nunca fora desta máquina (nem na produção)
    case "$host" in
      127.0.0.1 | localhost) ;;
      *)
        echo "varrer: a varredura ativa só roda num endereço local (127.0.0.1); recebi $host" >&2
        exit 2
        ;;
    esac
    minutes="${ZAP_ATIVO_MINUTOS:-30}"
    [[ "$minutes" =~ ^[1-9][0-9]{0,2}$ ]] || {
      echo "varrer: ZAP_ATIVO_MINUTOS precisa ser um número de minutos ($minutes)" >&2
      exit 2
    }
    ;;
  *)
    echo "varrer: ZAP_MODO precisa ser passivo ou ativo ($mode)" >&2
    exit 2
    ;;
esac

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
name="$name$suffix"
export ZAP_ALVO="$target" ZAP_NOME="$name"

# O plano desta rodada, numa pasta temporária: o plano.yaml como está (passiva) ou com o job do
# ativo.yaml no lugar da linha "# @ativo" e o spider enviando também os formulários POST (ativa)
plan_dir="$(mktemp -d)"
trap 'rm -rf "$plan_dir"' EXIT
if [ "$mode" = ativo ]; then
  awk -v extra="$here/ativo.yaml" -v minutes="$minutes" '
    /^  # @ativo$/ { while ((getline line < extra) > 0) { if (line ~ /# @minutos$/) sub(/: [0-9]+ /, ": " minutes " ", line); print (line == "" ? "" : "  " line) }; next }
    /^      postForm: false$/ { print "      postForm: true"; next }
    { print }
  ' "$here/plano.yaml" > "$plan_dir/plano.yaml"
  grep -q "type: activeScan" "$plan_dir/plano.yaml" || {
    echo "varrer: não consegui montar o plano ativo (a linha # @ativo sumiu do plano.yaml?)" >&2
    exit 2
  }
  grep -q "maxScanDurationInMins: $minutes # @minutos$" "$plan_dir/plano.yaml" || {
    echo "varrer: não consegui pôr o teto de $minutes min (a marca # @minutos sumiu do ativo.yaml?)" >&2
    exit 2
  }
else
  cp "$here/plano.yaml" "$plan_dir/plano.yaml"
fi
chmod -R a+rX "$plan_dir"

every="${ZAP_PROGRESSO_SEGUNDOS:-60}"
[[ "$every" =~ ^[1-9][0-9]{0,3}$ ]] || {
  echo "varrer: ZAP_PROGRESSO_SEGUNDOS precisa ser um número de segundos ($every)" >&2
  exit 2
}
limit_note=""
[ "$mode" = ativo ] && limit_note=" (teto de $minutes min nesta rodada)"

# Roda o ZAP em segundo plano e, enquanto ele trabalha, escreve uma linha a cada $every segundos.
# Devolve a saída do próprio ZAP. Confere a cada segundo, então o fim nunca espera o próximo aviso.
# Num script, o que roda em segundo plano ignora o Ctrl+C: o trap repassa o pedido de parar (o
# docker run repassa ao container), para nenhum ZAP ficar atacando sozinho depois do Ctrl+C.
run_with_progress() {
  local started=$SECONDS next=$every
  "$@" &
  zap_pid=$!
  trap 'kill "$zap_pid" 2>/dev/null; wait "$zap_pid" 2>/dev/null; exit 130' INT TERM
  while kill -0 "$zap_pid" 2>/dev/null; do
    sleep 1
    if [ $((SECONDS - started)) -ge "$next" ]; then
      echo "varrer: $name rodando há $(((SECONDS - started) / 60)) min $(((SECONDS - started) % 60)) s$limit_note"
      next=$((next + every))
    fi
  done
  trap - INT TERM
  wait "$zap_pid"
}

echo "varrer: $name em $target (relatórios em $reports)"
set +e
if [ -n "${ZAP_SH:-}" ]; then
  home="$(mktemp -d)"
  ZAP_RELATORIOS="$reports" run_with_progress "$ZAP_SH" -cmd -silent -dir "$home" -autorun "$plan_dir/plano.yaml"
  status=$?
  rm -rf "$home"
else
  # O ZAP da imagem roda como o usuário "zap": a pasta dos relatórios precisa aceitar gravação
  chmod a+rwx "$reports"
  run_with_progress docker run --rm --network host \
    -v "$plan_dir:/zap/plano:ro" -v "$reports:/zap/wrk:rw" \
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
