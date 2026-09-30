#!/usr/bin/env bash
# Recusa arquivos que parecem dados financeiros reais fora de samples/.
#
# Uso:
#   scripts/check_no_financial_data.sh arquivo1 arquivo2 ...   (o hook passa os arquivos do commit)
#   git ls-files | xargs scripts/check_no_financial_data.sh     (o CI confere o repositório inteiro)
#
# Por que existe: o .gitignore impede que esses arquivos sejam adicionados por
# engano, mas "git add -f" passa por cima dele. Este script é a segunda barreira.
set -euo pipefail

status=0
for f in "$@"; do
  case "$f" in
    samples/*) continue ;;   # exemplos sintéticos são permitidos
  esac
  # ${f,,} = nome do arquivo em minúsculas, para pegar .PDF e .Ofx também
  case "${f,,}" in
    *.ofx|*.qfx|*.pdf|*.csv|*.xls|*.xlsx|*.sqlite|*.sqlite3|*.db|*.dump|*.sql.gz|*.age)
      echo "BLOQUEADO: $f parece dado financeiro. Guarde em ~/fintrack-data, fora do repositório." >&2
      status=1
      ;;
  esac
done
exit $status
