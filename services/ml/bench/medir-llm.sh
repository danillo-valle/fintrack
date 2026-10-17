#!/usr/bin/env bash
# Mede um LLM local no SEU servidor, com a produção no ar (M10.2a, ADR-007).
#
#   services/ml/bench/medir-llm.sh --rapido qwen2.5-1.5b    confere a montagem (uns 5 min)
#   services/ml/bench/medir-llm.sh qwen2.5-1.5b             a medição completa (200 pedidos)
#   services/ml/bench/medir-llm.sh --sem-producao MODELO    sem medir o /api/health da produção
#
# Os modelos possíveis estão em bench/modelos.tsv. O que este script faz:
#   1. baixa o modelo do Hugging Face para ~/fintrack-llm/modelos e confere o sha256
#   2. sobe o llama-server (imagem oficial do llama.cpp) num container com teto de CPU e de
#      memória, sem swap, só leitura, sem privilégios, porta só em 127.0.0.1
#   3. roda bench.medir (itens SINTÉTICOS) e mede a produção, a temperatura e a memória
#   4. derruba o container (sempre, até com Ctrl+C) e mostra o relatório
#
# Nada aqui lê o banco nem lançamentos reais. O modelo fica fora do repositório.
#
# Ajustes (variáveis de ambiente): LLM_CPUS (padrão 2), LLM_THREADS (padrão = LLM_CPUS),
# LLM_MEMORIA (3g), LLM_CONTEXTO (2048), LLAMA_IMAGEM (ghcr.io/ggml-org/llama.cpp:server),
# FINTRACK_LLM_DIR (~/fintrack-llm).
set -euo pipefail

CONTAINER=fintrack-llm-medicao
PORTA=8090
WEB=fintrack-prod-web-1
REDE_WEB=fintrack-prod_entrada

erro() { printf '\033[31mPARE:\033[0m %s\n' "$*" >&2; exit 1; }
info() { printf '\033[1m==>\033[0m %s\n' "$*"; }

rapido=""
producao=1
modelo=""
for arg in "$@"; do
  case "$arg" in
    --rapido) rapido=1 ;;
    --sem-producao) producao="" ;;
    -h | --help) sed -n '2,20p' "$0"; exit 0 ;;
    -*) erro "opção desconhecida: $arg" ;;
    *) modelo="$arg" ;;
  esac
done

ML="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
TSV="$ML/bench/modelos.tsv"
[ -n "$modelo" ] || erro "diga o modelo: $(tail -n +2 "$TSV" | cut -f1 | paste -sd' ')"
linha=$(awk -F'\t' -v m="$modelo" 'NR > 1 && $1 == m' "$TSV")
[ -n "$linha" ] || erro "modelo desconhecido: $modelo (veja $TSV)"
IFS=$'\t' read -r _ repo arquivo licenca uso <<<"$linha"

for programa in docker uv curl; do
  command -v "$programa" >/dev/null || erro "falta o programa $programa"
done
docker info >/dev/null 2>&1 || erro "o Docker não respondeu (o seu usuário está no grupo docker?)"

CPUS="${LLM_CPUS:-2}"
THREADS="${LLM_THREADS:-$CPUS}"
MEMORIA="${LLM_MEMORIA:-3g}"
CONTEXTO="${LLM_CONTEXTO:-2048}"
IMAGEM="${LLAMA_IMAGEM:-ghcr.io/ggml-org/llama.cpp:server}"
BASE="${FINTRACK_LLM_DIR:-$HOME/fintrack-llm}"
case "$BASE" in
  "$ML"* | "$(dirname "$(dirname "$ML")")"*) erro "FINTRACK_LLM_DIR não pode ficar dentro do repositório" ;;
esac
mkdir -p "$BASE/modelos" "$BASE/resultados"

cd "$ML"

info "1/4 modelo $modelo"
uv run --frozen python -m bench.baixar --repo "$repo" --arquivo "$arquivo" --pasta "$BASE/modelos"

info "2/4 llama-server ($IMAGEM)"
docker pull -q "$IMAGEM" >/dev/null
# O digest (sha256) fixa a versão exata medida: é ele que vai para o relatório e para o ADR
digest=$(docker image inspect --format '{{range .RepoDigests}}{{.}} {{end}}' "$IMAGEM" | cut -d' ' -f1)
[ -n "$digest" ] || digest="$IMAGEM"
if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORTA"; then
  erro "a porta $PORTA já está em uso (outra medição? docker rm -f $CONTAINER)"
fi
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
SAIDA=""
limpar() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap limpar EXIT
# Ctrl+C: o bench.medir grava o que já mediu antes de sair; aqui só derruba e mostra onde ficou
trap 'limpar; [ -n "$SAIDA" ] && printf "\nRelatório (parcial): %s/relatorio.md\n" "$SAIDA"; exit 130' INT TERM
# --cpus: teto de núcleos; --cpu-shares 256: na disputa, a produção (1024) tem prioridade
# --memory-swap igual a --memory: o container não usa swap (se faltar memória, ele morre, e a
# medição mostra o erro em vez de empurrar a produção para o swap)
docker run -d --name "$CONTAINER" \
  --cpus "$CPUS" --cpu-shares 256 --memory "$MEMORIA" --memory-swap "$MEMORIA" \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true \
  --user 65534:65534 \
  -v "$BASE/modelos/$arquivo:/models/modelo.gguf:ro" \
  -p "127.0.0.1:$PORTA:8080" \
  "$digest" \
  -m /models/modelo.gguf --host 0.0.0.0 --port 8080 \
  -t "$THREADS" -c "$CONTEXTO" -np 1 --offline --no-webui >/dev/null
cid=$(docker inspect --format '{{.Id}}' "$CONTAINER")

saude=()
if [ -n "$producao" ]; then
  ip=$(docker inspect --format "{{with index .NetworkSettings.Networks \"$REDE_WEB\"}}{{.IPAddress}}{{end}}" "$WEB" 2>/dev/null || true)
  [ -n "$ip" ] || erro "não achei o container $WEB da produção (rode com --sem-producao para medir sem ela)"
  curl -fsS --max-time 5 "http://$ip:3000/api/health" | grep -q '"status":"ok"' \
    || erro "o /api/health da produção não respondeu ok em http://$ip:3000"
  saude=(--saude "http://$ip:3000/api/health")
fi

quando=$(date +%Y%m%d-%H%M)
SAIDA="$BASE/resultados/$quando-$modelo${rapido:+-rapido}"
mkdir -p "$SAIDA"
META_MODELO="$BASE/modelos/$arquivo.json" SAIDA="$SAIDA" MODELO="$modelo" LICENCA="$licenca" \
  USO="$uso" IMAGEM="$digest" CPUS="$CPUS" THREADS="$THREADS" MEMORIA="$MEMORIA" \
  python3 - <<'PY'
import json, os
meta = json.load(open(os.environ["META_MODELO"]))
meta.update(
    modelo=os.environ["MODELO"], licenca=os.environ["LICENCA"],
    uso_pessoal_gratis=os.environ["USO"] == "sim", imagem=os.environ["IMAGEM"],
    cpus=os.environ["CPUS"], threads=os.environ["THREADS"], memoria=os.environ["MEMORIA"],
)
open(os.path.join(os.environ["SAIDA"], "meta.json"), "w").write(json.dumps(meta, indent=2) + "\n")
PY

info "3/4 medição (${rapido:+rápida, }itens sintéticos; Ctrl+C para no meio e grava o que tiver)"
status=0
uv run --frozen python -m bench.medir --url "http://127.0.0.1:$PORTA" --saida "$SAIDA" \
  --container "$cid" "${saude[@]}" ${rapido:+--rapido} || status=$?

info "4/4 desligando o llama-server"
limpar
printf '\nRelatório: %s/relatorio.md\n' "$SAIDA"
exit "$status"
