#!/usr/bin/env bash
# Mede a nota de acessibilidade do Lighthouse (0 a 100) em cada página do app.
# Precisa do app rodando: deixe "pnpm dev" aberto em outro terminal.
#
# As páginas do app exigem sessão desde o M03. O script usa a sessão da conta de teste,
# gravada pelos testes E2E em apps/web/e2e/.auth/ana.json: rode "pnpm e2e" antes, uma vez.
#
# Uso: bash scripts/lighthouse-a11y.sh
#      MIN_SCORE=100 bash scripts/lighthouse-a11y.sh   (exige nota máxima)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

BASE_URL="${BASE_URL:-http://localhost:3000}"
MIN_SCORE="${MIN_SCORE:-95}"
AUTH_FILE="apps/web/e2e/.auth/ana.json"
# Telas de entrada (sem sessão) e páginas do app (com a sessão da conta de teste)
PUBLIC_PAGES=(/entrar /cadastro /esqueci-a-senha)
# Desde o M06: as telas do lar e de carteira (o id fixo é a "Casa da Ana", criada pelo auth.setup.ts)
APP_PAGES=(/ /lancamentos /lancamentos/novo /orcamento /carteiras /carteiras/nova
  /carteiras/e2e00000-0000-4000-8000-00000000a002 /ajustes /ajustes/lar /ajustes/seguranca /dev/ui
  /lancamentos/e2e00000-0000-4000-8000-00000000a030 /lancamentos/transferencia
  /lancamentos/recorrencias /ajustes/contas /ajustes/categorias)

# Confere se o app está no ar antes de começar
if ! curl -fsS "$BASE_URL/api/health" >/dev/null; then
  echo "O app não respondeu em $BASE_URL. Rode 'pnpm dev' em outro terminal e tente de novo." >&2
  exit 1
fi
if [ ! -f "$AUTH_FILE" ]; then
  echo "Falta a sessão de teste ($AUTH_FILE). Rode 'pnpm e2e' uma vez e tente de novo." >&2
  exit 1
fi

# Monta o cabeçalho Cookie a partir do arquivo de sessão do Playwright
COOKIE=$(node -e 'const s=require("./'"$AUTH_FILE"'"); console.log(s.cookies.map(c=>`${c.name}=${c.value}`).join("; "))')
# A sessão precisa estar válida: sem ela, as páginas do app viram a tela de login
if [ "$(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: $COOKIE" "$BASE_URL/ajustes")" != "200" ]; then
  echo "A sessão de teste expirou ou não vale mais. Rode 'pnpm e2e' de novo." >&2
  exit 1
fi

score() {
  # --only-categories: só acessibilidade (mais rápido); --output=json na saída padrão
  pnpm --reporter=silent dlx lighthouse@13 "$BASE_URL$1" \
    --only-categories=accessibility --output=json --quiet \
    --chrome-flags="--headless=new --no-sandbox" "${@:2}" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(Math.round(JSON.parse(s).categories.accessibility.score*100)))'
}

status=0
report() {
  if [ "$1" -ge "$MIN_SCORE" ]; then
    printf '  OK     %3s  %s\n' "$1" "$2"
  else
    printf '  FALHA  %3s  %s  (mínimo %s)\n' "$1" "$2" "$MIN_SCORE"
    status=1
  fi
}

for path in "${PUBLIC_PAGES[@]}"; do
  report "$(score "$path")" "$path"
done
for path in "${APP_PAGES[@]}"; do
  # --extra-headers manda o cookie da sessão em todas as requisições da página
  report "$(score "$path" --extra-headers="{\"Cookie\":\"$COOKIE\"}")" "$path"
done
exit $status
