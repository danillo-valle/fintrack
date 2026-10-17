"""A medição de um modelo: manda os itens sintéticos ao llama-server, um por vez, e mede tudo.

Quem chama é o bench/medir-llm.sh (que baixa o modelo, sobe o container e grava o meta.json).
Direto, só para depurar:

    uv run python -m bench.medir --url http://127.0.0.1:8090 --saida /tmp/m [--rapido]

As fases:
  1. repouso   60 s com o modelo carregado e parado: a base do /api/health e da temperatura
  2. 1ª passada os 150 itens (teste, lojas novas, injeção), na ordem da fila: despesas e depois
               receitas (a fila de verdade agruparia assim, para aproveitar o cache do prompt)
  3. sustentado repete a fila até 200 pedidos: o calor e o clock sob carga contínua (ADR-007)
--rapido: 20 itens, 15 s de repouso e sem a fase 3 (só para conferir que tudo está montado).

Grava na pasta: itens.jsonl (cada pedido; só descrições sintéticas), amostras.jsonl, saude.jsonl,
resumo.json e relatorio.md.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import asdict
from pathlib import Path

from . import cliente, conjuntos, monitor, prompt, relatorio

TOTAL = 200
REPOUSO = 60
REPOUSO_RAPIDO = 15
# Os "timings" do llama-server que vão para cada linha (cache_n: tokens reaproveitados do cache)
TEMPOS = (
    "cache_n",
    "prompt_n",
    "prompt_ms",
    "prompt_per_second",
    "predicted_n",
    "predicted_ms",
    "predicted_per_second",
)


def fila(itens: list[conjuntos.Item]) -> list[conjuntos.Item]:
    """Despesas primeiro e receitas depois (estável: dentro de cada tipo, a ordem dos conjuntos)."""
    return sorted(itens, key=lambda item: item.tipo != "expense")


def pedir(url: str, item: conjuntos.Item, categorias: dict[str, list[str]]) -> dict:
    lista = categorias[item.tipo]
    resposta = cliente.completar(url, prompt.pedido(item.descricao, item.tipo, lista))
    categoria = None if resposta.conteudo is None else prompt.validar(resposta.conteudo, lista)
    linha = asdict(item)
    linha.update(
        {
            "sobra": item.sobra,
            "resposta": (resposta.conteudo or "")[:300],
            "categoria": categoria,
            "json_valido": categoria is not None,
            "erro": resposta.erro,
            "ms": round(resposta.ms, 1),
        }
    )
    for chave in TEMPOS:
        linha[chave] = resposta.tempos.get(chave)
    return linha


def _gravar_jsonl(caminho: Path, linhas: list[dict]) -> None:
    with caminho.open("w", encoding="utf-8") as arquivo:
        for linha in linhas:
            arquivo.write(json.dumps(linha, ensure_ascii=False) + "\n")


def medir(
    url: str,
    saida: Path,
    rapido: bool = False,
    container: str = "",
    saude_url: str | None = None,
    total: int | None = None,
    repouso: float | None = None,
    meta: dict | None = None,
    mostrar=print,
) -> dict:
    url = cliente.conferir_url(url)
    saida.mkdir(parents=True, exist_ok=True)
    meta = dict(meta or {})
    caminho_meta = saida / "meta.json"
    if caminho_meta.exists():
        meta = {**json.loads(caminho_meta.read_text(encoding="utf-8")), **meta}
    meta.setdefault("quando", time.strftime("%Y-%m-%d %H:%M"))
    meta["rapido"] = rapido

    if not cliente.esperar_pronto(url):
        raise SystemExit(f"o llama-server em {url} não ficou pronto")
    meta.update(cliente.propriedades(url))

    itens = conjuntos.carregar()
    if rapido:
        itens = conjuntos.rapido(itens)
    ordem = fila(itens)
    quantos = len(ordem) if rapido else max(total or TOTAL, len(ordem))
    categorias = conjuntos.categorias_por_tipo()

    amostrador = monitor.Amostrador(container)
    amostrador.start()
    saude = monitor.Saude(cliente.conferir_url(saude_url)) if saude_url else None
    if saude:
        saude.start()
    espera = repouso if repouso is not None else (REPOUSO_RAPIDO if rapido else REPOUSO)
    linhas: list[dict] = []
    interrompida = False
    inicio_carga = time.time() + espera
    try:
        mostrar(f"repouso de {espera:.0f} s (a base da produção e da temperatura)...")
        time.sleep(espera)
        inicio_carga = time.time()
        for n in range(quantos):
            item = ordem[n % len(ordem)]
            linha = pedir(url, item, categorias)
            linha["n"], linha["rodada"] = n, n // len(ordem)
            linhas.append(linha)
            if (n + 1) % 10 == 0 or n + 1 == quantos:
                tempos = [x["ms"] for x in linhas if x["erro"] is None]
                p50 = relatorio.segundos(relatorio.percentil(tempos, 50))
                mostrar(
                    f"  {n + 1:>3}/{quantos}  p50 {p50}"
                    f"  erros {sum(1 for x in linhas if x['erro'])}"
                )
    except KeyboardInterrupt:
        interrompida = True
        mostrar("interrompida: grava o que já foi medido")
    finally:
        amostras = amostrador.parar()
        medidas_saude = saude.parar() if saude else []

    _gravar_jsonl(saida / "itens.jsonl", linhas)
    _gravar_jsonl(saida / "amostras.jsonl", amostras)
    _gravar_jsonl(saida / "saude.jsonl", medidas_saude)
    resumo = relatorio.resumir(linhas, amostras, medidas_saude, inicio_carga, meta, interrompida)
    (saida / "resumo.json").write_text(
        json.dumps(resumo, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (saida / "relatorio.md").write_text(relatorio.texto(resumo), encoding="utf-8")
    return resumo


def main(argv: list[str] | None = None) -> int:
    opcoes = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    opcoes.add_argument("--url", required=True, help="o llama-server (http://127.0.0.1:8090)")
    opcoes.add_argument("--saida", required=True, type=Path)
    opcoes.add_argument("--rapido", action="store_true")
    opcoes.add_argument("--container", default="", help="id do container (memória pelo cgroup)")
    opcoes.add_argument("--saude", default=None, help="o /api/health da produção")
    opcoes.add_argument("--total", type=int, default=None)
    opcoes.add_argument("--repouso", type=float, default=None)
    args = opcoes.parse_args(argv)
    resumo = medir(
        args.url, args.saida, args.rapido, args.container, args.saude, args.total, args.repouso
    )
    print()
    print((args.saida / "relatorio.md").read_text(encoding="utf-8"))
    return 1 if resumo["erros"] or resumo["interrompida"] else 0


if __name__ == "__main__":
    sys.exit(main())
