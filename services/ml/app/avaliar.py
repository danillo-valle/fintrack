"""A avaliação do classificador no conjunto rotulado SINTÉTICO (M10.1, ADR-015).

    uv run python -m app.avaliar               mostra o resultado
    uv run python -m app.avaliar --minimo 0.85 falha (saída 1) se o acerto ficar abaixo de 85 %
    uv run python -m app.avaliar --gravar      grava app/avaliacao.json e o bloco do README.md

O conjunto (samples/categorizacao/rotulado.csv, gerado por scripts/gerar_rotulado.py) é dividido
sempre do mesmo jeito: 70 % para treinar e 30 % para testar, sorteados por categoria com uma
semente fixa. Os números:

  acerto      em quantas descrições de teste a 1ª categoria do modelo é a certa
  cobertura   em quantas a confiança (com a trava da evidência) chega ao limiar (80): essas o
              classificador resolve sozinho, sem LLM; as outras ficam sem sugestão (ou, no
              M10.2, vão para a fila do LLM)
  acerto_no_limiar  o acerto só nas que passaram do limiar (o que a pessoa vê sugerido)

O CI roda o pytest, que repete esta conta e confere: acerto >= 85 % e o app/avaliacao.json e o
README iguais ao resultado (um número velho no README faz o teste falhar).
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import sys
from collections import defaultdict
from pathlib import Path

from .classificador import Exemplo, Modelo, treinar

RAIZ = Path(__file__).resolve().parents[3]
CONJUNTO = RAIZ / "samples" / "categorizacao" / "rotulado.csv"
README = RAIZ / "README.md"
RESULTADO = Path(__file__).resolve().parent / "avaliacao.json"
LIMIAR = 80
MINIMO = 0.85
SEMENTE = 2026
FRACAO_TESTE = 0.3
INICIO = "<!-- avaliacao-classificador: início -->"
FIM = "<!-- avaliacao-classificador: fim -->"


def ler_conjunto(caminho: Path = CONJUNTO) -> list[Exemplo]:
    with caminho.open(encoding="utf-8", newline="") as arquivo:
        return [
            Exemplo(linha["descricao"], linha["tipo"], linha["categoria"])
            for linha in csv.DictReader(arquivo, delimiter=";")
        ]


def dividir(exemplos: list[Exemplo]) -> tuple[list[Exemplo], list[Exemplo]]:
    por_categoria: dict[str, list[Exemplo]] = defaultdict(list)
    for exemplo in exemplos:
        por_categoria[exemplo.categoria].append(exemplo)
    sorteio = random.Random(SEMENTE)  # noqa: S311 (sorteio reproduzível, não é segredo)
    treino: list[Exemplo] = []
    teste: list[Exemplo] = []
    for categoria in sorted(por_categoria):
        grupo = list(por_categoria[categoria])
        sorteio.shuffle(grupo)
        corte = round(len(grupo) * FRACAO_TESTE)
        teste.extend(grupo[:corte])
        treino.extend(grupo[corte:])
    return treino, teste


def avaliar(exemplos: list[Exemplo] | None = None) -> dict:
    treino, teste = dividir(exemplos if exemplos is not None else ler_conjunto())
    modelo: Modelo = treinar(treino)
    certos = cobertos = certos_cobertos = 0
    for exemplo in teste:
        # A mesma conta da sugestão: a probabilidade com a trava da evidência
        pontos = modelo.pontuar(exemplo.descricao, exemplo.tipo)
        categoria, prob = max(pontos.items(), key=lambda item: (item[1], item[0]))
        acertou = categoria == exemplo.categoria
        certos += acertou
        if prob * 100 >= LIMIAR:
            cobertos += 1
            certos_cobertos += acertou
    return {
        "conjunto": "samples/categorizacao/rotulado.csv",
        "exemplos_treino": len(treino),
        "exemplos_teste": len(teste),
        "categorias": modelo.categorias,
        "limiar": LIMIAR,
        "minimo": MINIMO,
        "acerto": round(certos / len(teste), 4),
        "cobertura": round(cobertos / len(teste), 4),
        "acerto_no_limiar": round(certos_cobertos / cobertos, 4) if cobertos else 0.0,
    }


def porcentagem(valor: float) -> str:
    return f"{valor * 100:.1f}".replace(".", ",") + " %"


def bloco_readme(resultado: dict) -> str:
    return "\n".join(
        [
            INICIO,
            "",
            "| Medida (conjunto sintético, "
            f"{resultado['exemplos_teste']} descrições de teste) | Resultado |",
            "| --- | --- |",
            f"| Acerto do classificador (mínimo {porcentagem(resultado['minimo'])}) "
            f"| {porcentagem(resultado['acerto'])} |",
            f"| Resolvido sem LLM (confiança ≥ {resultado['limiar']} %) "
            f"| {porcentagem(resultado['cobertura'])} |",
            "| Acerto no que foi resolvido sem LLM "
            f"| {porcentagem(resultado['acerto_no_limiar'])} |",
            "",
            FIM,
        ]
    )


def trocar_bloco(texto: str, bloco: str) -> str:
    inicio, fim = texto.index(INICIO), texto.index(FIM) + len(FIM)
    return texto[:inicio] + bloco + texto[fim:]


def main(argv: list[str] | None = None) -> int:
    opcoes = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    opcoes.add_argument("--minimo", type=float, default=None)
    opcoes.add_argument("--gravar", action="store_true")
    args = opcoes.parse_args(argv)
    resultado = avaliar()
    print(json.dumps(resultado, ensure_ascii=False, indent=2))
    if args.gravar:
        RESULTADO.write_text(json.dumps(resultado, ensure_ascii=False, indent=2) + "\n")
        README.write_text(trocar_bloco(README.read_text(encoding="utf-8"), bloco_readme(resultado)))
        print(f"gravado: {RESULTADO.name} e o bloco do README.md")
    if args.minimo is not None and resultado["acerto"] < args.minimo:
        print(
            f"FALHOU: acerto {porcentagem(resultado['acerto'])} abaixo do mínimo "
            f"{porcentagem(args.minimo)}",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
