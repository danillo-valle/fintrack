#!/usr/bin/env bash
# Testes dos scripts de operação (deploy/bin) que dá para rodar sem servidor: o fintrack-alerta, o
# aviso ao Healthchecks (hc_ping), a contagem dos eventos de segurança, a seção Segurança do
# fintrack-status e o fintrack-definir; e o progresso do scripts/zap/varrer.sh (M12.4b).
# Roda no CI (job imagem, logo depois do shellcheck) e em qualquer máquina com bash, curl e python3:
#
#   bash deploy/testes/operacao.test.sh
#
# Nada de Docker nem de Healthchecks de verdade: um "docker" de mentira devolve o log do app que o
# teste escolhe (ou falha), e um Healthchecks de mentira (python, só em 127.0.0.1) responde o
# código que o teste escolhe e anota cada aviso recebido. O FINTRACK_HOME é uma pasta temporária.
#
# Nasceu na revisão 3 do M12.4a: com zero eventos na janela (o normal), o grep devolvia 1 e o
# pipefail transformava "nenhum evento" em "não consegui ler o log". O primeiro caso abaixo é esse.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="$ROOT/deploy/bin"
WORK="$(mktemp -d)"
HC_PID=""
cleanup() {
  [ -z "$HC_PID" ] || kill "$HC_PID" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# ── O Healthchecks de mentira ───────────────────────────────────────────────────────────
# Responde o código escrito em $WORK/hc-codigo (200 se não existir) e anota "MÉTODO caminho" e o
# corpo de cada aviso em $WORK/hc-pedidos. Porta escolhida pelo sistema, gravada em $WORK/hc-porta.
cat > "$WORK/hc.py" <<'PY'
import http.server, pathlib, sys

work = pathlib.Path(sys.argv[1])

class Handler(http.server.BaseHTTPRequestHandler):
    def answer(self):
        size = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(size).decode() if size else ""
        with open(work / "hc-pedidos", "a") as log:
            log.write(f"{self.command} {self.path}\n{body}\n---\n")
        code_file = work / "hc-codigo"
        code = int(code_file.read_text()) if code_file.exists() else 200
        self.send_response(code)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"OK")

    do_GET = do_POST = do_HEAD = answer

    def log_message(self, *args):
        pass

server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
(work / "hc-porta").write_text(str(server.server_address[1]))
server.serve_forever()
PY
python3 "$WORK/hc.py" "$WORK" &
HC_PID=$!
for _ in $(seq 1 50); do [ -s "$WORK/hc-porta" ] && break; sleep 0.1; done
[ -s "$WORK/hc-porta" ] || { echo "o Healthchecks de mentira não subiu"; exit 1; }
CODE="0b5e3c1a-9f2d-4e8b-a7c6-1d2e3f4a5b6c"
HC="http://127.0.0.1:$(cat "$WORK/hc-porta")"

# ── O docker de mentira ─────────────────────────────────────────────────────────────────
# "docker compose ... logs ..." imprime $WORK/log-do-app; com $WORK/docker-falha, falha como um
# docker parado
mkdir -p "$WORK/stub"
cat > "$WORK/stub/docker" <<SH
#!/usr/bin/env bash
[ -e "$WORK/docker-falha" ] && { echo "Cannot connect to the Docker daemon" >&2; exit 1; }
case " \$* " in *" logs "*) cat "$WORK/log-do-app" ;; esac
SH
chmod +x "$WORK/stub/docker"
export PATH="$WORK/stub:$PATH"

# ── O FINTRACK_HOME de mentira ──────────────────────────────────────────────────────────
export FINTRACK_HOME="$WORK/home"
mkdir -p "$FINTRACK_HOME/estado" "$FINTRACK_HOME/repo"
ln -s "$ROOT/deploy" "$FINTRACK_HOME/repo/deploy"

# Uma linha de log do app com o evento (o resto da linha imita o logger: nunca dado de pessoa)
evento() { printf 'web-1  | {"level":40,"event":"%s","msg":"teste"}\n' "$1"; }

# Prepara um caso: o log do app, o código do Healthchecks e o operacao.env
caso() {
  NOME="$1"
  : > "$WORK/log-do-app"
  rm -f "$WORK/hc-pedidos" "$WORK/hc-codigo" "$WORK/docker-falha" "$FINTRACK_HOME/estado/alertas.log"
  printf 'HC_SEGURANCA_URL="%s/%s"\n' "$HC" "$CODE" > "$FINTRACK_HOME/operacao.env"
}

FALHAS=0
CASOS=0
# confere <descrição> <comando...>: roda o comando (sem eval) e anota ok ou FALHA
confere() {
  local what="$1"
  shift
  CASOS=$((CASOS + 1))
  if "$@"; then
    printf '  ok    %s: %s\n' "$NOME" "$what"
  else
    FALHAS=$((FALHAS + 1))
    printf '  FALHA %s: %s\n' "$NOME" "$what"
  fi
}

# Roda um comando e guarda a saída (stdout e stderr juntos) e o código de saída
roda() {
  set +e
  SAIDA=$("$@" 2>&1)
  STATUS=$?
  set -e
}

pedidos() { cat "$WORK/hc-pedidos" 2>/dev/null || true; }
terminou_bem() { [ "$STATUS" = 0 ]; }
terminou_com_erro() { [ "$STATUS" != 0 ]; }
saida_tem() { grep -qF -- "$1" <<< "$SAIDA"; }
saida_sem() { ! grep -qE -- "$1" <<< "$SAIDA"; }
primeiro_pedido() { [ "$(pedidos | head -n 1)" = "$1" ]; }
pedidos_tem() { pedidos | grep -qF -- "$1"; }
sem_pedido() { [ -z "$(pedidos)" ]; }
alertas_tem() { grep -qF -- "$1" "$FINTRACK_HOME/estado/alertas.log" 2>/dev/null; }
sem_alertas() { [ ! -e "$FINTRACK_HOME/estado/alertas.log" ]; }

echo "fintrack-alerta"

caso "zero eventos (o defeito da revisão 3)"
evento "transaction.created" > "$WORK/log-do-app"
roda "$BIN/fintrack-alerta"
confere "termina bem" terminou_bem
confere "avisa ok ao Healthchecks" primeiro_pedido "GET /$CODE"
confere "sem AVISO nem ERRO" saida_sem "AVISO|ERRO"

caso "log vazio"
roda "$BIN/fintrack-alerta"
confere "termina bem" terminou_bem
confere "avisa ok" primeiro_pedido "GET /$CODE"

caso "eventos abaixo do limite"
{ for _ in 1 2 3; do evento auth.failed; done; } > "$WORK/log-do-app"
roda "$BIN/fintrack-alerta"
confere "termina bem" terminou_bem
confere "avisa ok" primeiro_pedido "GET /$CODE"
confere "não grava no alertas.log" sem_alertas

caso "eventos acima do limite"
{ evento access.denied; for _ in $(seq 1 12); do evento auth.failed; done; } > "$WORK/log-do-app"
roda "$BIN/fintrack-alerta"
confere "termina bem" terminou_bem
confere "avisa /fail" primeiro_pedido "POST /$CODE/fail"
confere "o corpo tem auth.failed" pedidos_tem "auth.failed: 12 em 15m (limite 10)"
confere "o corpo tem access.denied" pedidos_tem "access.denied: 1 em 15m (limite 1)"
confere "grava no alertas.log" alertas_tem "auth.failed: 12"

caso "limite do operacao.env"
{ for _ in 1 2 3; do evento auth.failed; done; } > "$WORK/log-do-app"
echo "ALERTA_AUTH_FAILED=3" >> "$FINTRACK_HOME/operacao.env"
roda "$BIN/fintrack-alerta"
confere "usa o limite 3" pedidos_tem "auth.failed: 3 em 15m (limite 3)"

caso "acima do limite e o Healthchecks fora (503)"
evento access.denied > "$WORK/log-do-app"
echo 503 > "$WORK/hc-codigo"
roda "$BIN/fintrack-alerta"
confere "termina com erro" terminou_com_erro
confere "grava no alertas.log mesmo assim" alertas_tem "access.denied: 1"
confere "diz o código" saida_tem "resposta 503"

caso "docker parado"
touch "$WORK/docker-falha"
roda "$BIN/fintrack-alerta"
confere "termina com erro" terminou_com_erro
confere "explica" saida_tem "não consegui ler o log do app"
confere "avisa /fail" primeiro_pedido "POST /$CODE/fail"
confere "com o motivo no corpo" pedidos_tem "não conseguiu ler o log"

caso "--teste com o Healthchecks respondendo"
roda "$BIN/fintrack-alerta" --teste
confere "termina bem" terminou_bem
confere "diz que enviou" saida_tem "alerta de teste enviado"
confere "manda /fail" primeiro_pedido "POST /$CODE/fail"
confere "com o texto do teste" pedidos_tem "nenhum evento real"

caso "--teste com o endereço recusado (400)"
echo 400 > "$WORK/hc-codigo"
roda "$BIN/fintrack-alerta" --teste
confere "termina com erro" terminou_com_erro
confere "não diz que enviou" saida_sem "alerta de teste enviado"
confere "explica o 400" saida_tem "fora do formato"
confere "nunca mostra o endereço" saida_sem "$CODE"

caso "--teste com o check apagado (404)"
echo 404 > "$WORK/hc-codigo"
roda "$BIN/fintrack-alerta" --teste
confere "termina com erro" terminou_com_erro
confere "explica o 404" saida_tem "não achou o check"

caso "--teste sem resposta"
printf 'HC_SEGURANCA_URL="http://127.0.0.1:9/%s"\n' "$CODE" > "$FINTRACK_HOME/operacao.env"
roda "$BIN/fintrack-alerta" --teste
confere "termina com erro" terminou_com_erro
confere "diz que não houve resposta" saida_tem "sem resposta"
confere "nunca mostra o endereço" saida_sem "$CODE"

caso "sem HC_SEGURANCA_URL"
: > "$FINTRACK_HOME/operacao.env"
roda "$BIN/fintrack-alerta"
confere "termina bem" terminou_bem
confere "avisa que está desligado" saida_tem "alerta está desligado"
confere "não manda nada" sem_pedido

caso "argumento desconhecido"
roda "$BIN/fintrack-alerta" --outro
confere "recusa" terminou_com_erro
confere "mostra o uso" saida_tem "uso: fintrack-alerta"

echo "contagem dos eventos (lib.sh)"

contar() { bash -c 'source "$1/lib.sh"; security_event_counts 24h' _ "$BIN"; }
saida_vazia() { [ -z "$SAIDA" ]; }
contagem_certa() { [ "$(sed -E 's/^ +//; s/ +/ /' <<< "$SAIDA")" = "$(printf '2 auth.failed\n1 webhook.rejected')" ]; }

caso "sem evento"
evento "transaction.created" > "$WORK/log-do-app"
roda contar
confere "termina bem" terminou_bem
confere "não imprime nada" saida_vazia

caso "com eventos"
{ evento auth.failed; evento auth.failed; evento webhook.rejected; evento transaction.created; } > "$WORK/log-do-app"
roda contar
confere "conta só os de segurança" contagem_certa

caso "docker parado"
touch "$WORK/docker-falha"
roda contar
confere "devolve erro" terminou_com_erro

echo "fintrack-status (seção Segurança)"

caso "sem evento"
evento "transaction.created" > "$WORK/log-do-app"
roda "$BIN/fintrack-status"
confere "mostra nenhum evento" saida_tem "nenhum evento"
confere "segue para as outras seções" saida_tem "Últimos deploys"

caso "com eventos"
{ evento auth.failed; evento access.denied; } > "$WORK/log-do-app"
roda "$BIN/fintrack-status"
confere "mostra a contagem" saida_tem "1 access.denied"
confere "mostra o alerta ligado" saida_tem "alerta: ligado"

caso "docker parado"
touch "$WORK/docker-falha"
roda "$BIN/fintrack-status"
confere "diz que não leu o log" saida_tem "não consegui ler o log do app"
confere "segue para as outras seções" saida_tem "Últimos deploys"

echo "fintrack-definir (endereço do Healthchecks)"

define() { printf '%s\n' "$1" | "$BIN/fintrack-definir" operacao.env HC_SEGURANCA_URL; }
gravado_e() { [ "$(sed -n 's/^HC_SEGURANCA_URL=//p' "$FINTRACK_HOME/operacao.env")" = "\"$1\"" ]; }

for bom in "https://hc-ping.com/$CODE" "https://hc-ping.com/AbCdEfGhIjKlMnOpQrStUv/fintrack-seguranca" \
  "https://hc.exemplo.com.br/ping/$CODE"; do
  caso "aceita: ${bom//$CODE/<código>}"
  roda define "$bom"
  confere "termina bem" terminou_bem
  confere "grava" gravado_e "$bom"
done

for ruim in "https://hc-ping.com/59https://hc-ping.com/$CODE" "https://hc-ping.com/$CODE/" \
  "https://hc-ping.com/$CODE/fail" "https://hc-ping.com/$CODE " "http://hc-ping.com/$CODE" \
  "hc-ping.com/$CODE" "https://hc-ping.com/${CODE:0:30}"; do
  caso "recusa: ${ruim//$CODE/<código>}"
  roda define "$ruim"
  confere "termina com erro" terminou_com_erro
  confere "não grava" gravado_e "$HC/$CODE"
  confere "explica" saida_tem "não parece um endereço de ping"
  confere "nunca mostra o valor" saida_sem "${CODE:0:30}"
done

echo "varrer.sh (progresso da varredura)"

# Um ZAP de mentira (ZAP_SH): espera 3 s e grava um relatório sem alertas, como o ZAP de verdade
cat > "$WORK/zap.sh" <<'ZAP'
#!/usr/bin/env bash
sleep 3
printf '{"site": [{"alerts": []}]}\n' > "$ZAP_RELATORIOS/zap-$ZAP_NOME.json"
ZAP
chmod +x "$WORK/zap.sh"
varre() { ZAP_SH="$WORK/zap.sh" ZAP_PROGRESSO_SEGUNDOS=1 bash "$ROOT/scripts/zap/varrer.sh" "$@"; }

caso "rodada passiva"
roda varre http://127.0.0.1:3000 "$WORK/zap-relatorios"
confere "termina bem" terminou_bem
confere "mostra o progresso enquanto o ZAP trabalha" saida_tem "varrer: publico rodando há 0 min 1 s"
confere "termina com o resumo" saida_tem "varrer: publico OK"

caso "rodada ativa"
roda env ZAP_MODO=ativo ZAP_ATIVO_MINUTOS=5 ZAP_SH="$WORK/zap.sh" ZAP_PROGRESSO_SEGUNDOS=1 \
  bash "$ROOT/scripts/zap/varrer.sh" http://127.0.0.1:3000 "$WORK/zap-relatorios"
confere "diz o teto da rodada" saida_tem "(teto de 5 min nesta rodada)"
confere "termina com o resumo" saida_tem "varrer: publico-ativo OK"

caso "intervalo inválido"
roda env ZAP_SH="$WORK/zap.sh" ZAP_PROGRESSO_SEGUNDOS=0 bash "$ROOT/scripts/zap/varrer.sh" \
  http://127.0.0.1:3000 "$WORK/zap-relatorios"
confere "recusa" terminou_com_erro
confere "explica" saida_tem "ZAP_PROGRESSO_SEGUNDOS precisa ser um número"

echo "backup e deploy"

# Um aviso que falha nunca para o backup nem o deploy: toda chamada fora do alerta tem "|| true"
NOME="hc_ping acessório"
sem_chamada_solta() { ! grep -hE 'hc_ping ' "$BIN/fintrack-backup" "$BIN/fintrack-deploy" | grep -vF '|| true'; }
confere "toda chamada no backup e no deploy tem || true" sem_chamada_solta

echo
if [ "$FALHAS" -gt 0 ]; then
  echo "$FALHAS de $CASOS conferências falharam"
  exit 1
fi
echo "Tudo certo: $CASOS conferências"
