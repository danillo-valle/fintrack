#!/usr/bin/env bash
# Mede a nota de acessibilidade do Lighthouse (0 a 100) em cada página do app.
# Precisa do app rodando: deixe "pnpm dev" aberto em outro terminal.
#
# Uso: bash scripts/lighthouse-a11y.sh
#      MIN_SCORE=100 bash scripts/lighthouse-a11y.sh   (exige nota máxima)
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
MIN_SCORE="${MIN_SCORE:-95}"
PAGES=(/ /lancamentos /lancamentos/novo /orcamento /carteiras /ajustes /dev/ui)

# Confere se o app está no ar antes de começar
if ! curl -fsS "$BASE_URL/api/health" >/dev/null; then
  echo "O app não respondeu em $BASE_URL. Rode 'pnpm dev' em outro terminal e tente de novo." >&2
  exit 1
fi

status=0
for path in "${PAGES[@]}"; do
  # --only-categories: só acessibilidade (mais rápido); --output=json na saída padrão
  score=$(pnpm --reporter=silent dlx lighthouse@13 "$BASE_URL$path" \
    --only-categories=accessibility --output=json --quiet \
    --chrome-flags="--headless=new --no-sandbox" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(Math.round(JSON.parse(s).categories.accessibility.score*100)))')
  if [ "$score" -ge "$MIN_SCORE" ]; then
    printf '  OK     %3s  %s\n' "$score" "$path"
  else
    printf '  FALHA  %3s  %s  (mínimo %s)\n' "$score" "$path" "$MIN_SCORE"
    status=1
  fi
done
exit $status
