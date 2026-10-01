#!/usr/bin/env bash
# Deixa os anéis de foco dos componentes gerados pelo shadcn com contraste de pelo menos 3:1
# (WCAG 2.2, critério 1.4.11). O padrão do shadcn usa a cor do anel com 50% de opacidade
# (ring-ring/50), o que dá cerca de 2,4:1 no tema claro: difícil de ver para quem navega
# pelo teclado. Pode rodar mais de uma vez: na segunda, não muda nada.
#
# Uso (na raiz do repositório): bash scripts/corrige-aneis-de-foco.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# -i = edita o arquivo no lugar; -E = expressões regulares estendidas (o "?" funciona)
# [0-9]+ aceita qualquer opacidade (/20, /50, /70...), inclusive as que alguém tenha mudado à mão
sed -i -E \
  -e 's#ring-ring/[0-9]+#ring-ring#g' \
  -e 's# ?dark:aria-invalid:ring-destructive/[0-9]+##g' \
  -e 's# ?dark:focus-visible:ring-destructive/[0-9]+##g' \
  -e 's#aria-invalid:ring-destructive/[0-9]+#aria-invalid:focus-visible:ring-destructive#g' \
  -e 's#focus-visible:ring-destructive/[0-9]+#focus-visible:ring-destructive#g' \
  -e 's# aria-invalid:ring-3##g' \
  apps/web/src/components/ui/*.tsx

# Contorno padrão do navegador, usado quando um elemento não tem anel próprio
sed -i -E 's#outline-ring/[0-9]+#outline-ring#' apps/web/src/app/globals.css

# Mostra o que sobrou com opacidade (o esperado é não aparecer nada)
if grep -rnE "(ring|outline)-(ring|destructive)/[0-9]+" apps/web/src; then
  echo "Ainda há anéis com opacidade nas linhas acima." >&2
  exit 1
fi
echo "Anéis de foco com cor cheia em todos os componentes."
