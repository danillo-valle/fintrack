"""Os itens da medição, todos SINTÉTICOS (samples/categorizacao), e o que o classificador diria.

  teste    as 90 descrições de teste do eval do M10.1 (o mesmo sorteio de app.avaliar)
  dificil  45 descrições de lojas que o classificador nunca viu (llm-dificil.csv): o caso em
           que o LLM poderia ajudar, porque ele sabe que "QUITANDA" é mercado sem ter visto
  injecao  15 descrições com tentativa de prompt injection (llm-injecao.csv): a categoria
           certa e o "alvo" que o texto tenta impor

"O que sobra" (a pergunta do ADR-007): os itens de teste e difíceis em que o classificador,
treinado nos 70 % do conjunto rotulado, fica abaixo do limiar (80). É ali que o LLM entraria.
"""

from __future__ import annotations

import csv
import functools
from dataclasses import dataclass
from pathlib import Path

from app.avaliar import CONJUNTO, LIMIAR, dividir, ler_conjunto
from app.classificador import Modelo, confianca, treinar

PASTA = CONJUNTO.parent
DIFICIL = PASTA / "llm-dificil.csv"
INJECAO = PASTA / "llm-injecao.csv"


@dataclass(frozen=True)
class Item:
    conjunto: str  # teste | dificil | injecao
    descricao: str
    tipo: str
    esperado: str
    alvo: str | None = None  # só na injeção: a categoria que o texto tenta impor
    classificador: str | None = None  # a 1ª categoria do classificador
    confianca_classificador: int = 0

    @property
    def sobra(self) -> bool:
        """O classificador não resolveria sozinho (abaixo do limiar)."""
        return self.conjunto != "injecao" and self.confianca_classificador < LIMIAR


def _ler(caminho: Path) -> list[dict[str, str]]:
    with caminho.open(encoding="utf-8", newline="") as arquivo:
        return list(csv.DictReader(arquivo, delimiter=";"))


def categorias_por_tipo() -> dict[str, list[str]]:
    """As categorias do conjunto rotulado, por tipo, na ordem em que aparecem (a do prompt)."""
    saida: dict[str, list[str]] = {"expense": [], "income": []}
    for exemplo in ler_conjunto():
        if exemplo.categoria not in saida[exemplo.tipo]:
            saida[exemplo.tipo].append(exemplo.categoria)
    return saida


def _com_classificador(modelo: Modelo, item: Item) -> Item:
    pontos = modelo.pontuar(item.descricao, item.tipo)
    categoria, prob = max(pontos.items(), key=lambda par: (par[1], par[0]))
    return Item(
        item.conjunto,
        item.descricao,
        item.tipo,
        item.esperado,
        item.alvo,
        categoria,
        confianca(prob),
    )


def carregar() -> list[Item]:
    return list(_carregar())


@functools.cache
def _carregar() -> tuple[Item, ...]:
    """Treina o classificador uma vez por processo (os itens são imutáveis)."""
    treino, teste = dividir(ler_conjunto())
    modelo = treinar(treino)
    itens = [Item("teste", e.descricao, e.tipo, e.categoria) for e in teste]
    itens += [Item("dificil", r["descricao"], r["tipo"], r["categoria"]) for r in _ler(DIFICIL)]
    itens += [
        Item("injecao", r["descricao"], r["tipo"], r["categoria"], r["alvo"]) for r in _ler(INJECAO)
    ]
    return tuple(_com_classificador(modelo, item) for item in itens)


def rapido(itens: list[Item]) -> list[Item]:
    """Uma amostra pequena para conferir a montagem (--rapido): 10 + 5 + 5, sempre as mesmas."""
    saida: list[Item] = []
    for conjunto, quantos in (("teste", 10), ("dificil", 5), ("injecao", 5)):
        grupo = [i for i in itens if i.conjunto == conjunto]
        passo = max(1, len(grupo) // quantos)
        saida += grupo[::passo][:quantos]
    return saida
