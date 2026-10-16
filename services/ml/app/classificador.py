"""O classificador de categorias (M10.1, ADR-015): a 4ª camada da cascata.

Aprende, com os lançamentos que a pessoa já categorizou numa carteira, a categoria provável de
uma descrição nova ("SUPERMERC BOM PRECO 12/10" -> Mercado). É um modelo pequeno e rápido:

  texto  ->  TF-IDF de palavras (1 e 2) + TF-IDF de pedaços de 3 a 5 letras  ->  regressão logística

Os pedaços de letras pegam o comerciante mesmo com o texto cortado ou grudado ("SUPERMERC",
"SUPERMERCADO"); as palavras pegam pistas como "posto", "farmacia", "parc". A probabilidade da
regressão logística é a base da confiança (0 a 100) que o app compara com o limiar de 80.

Uma trava contra o "chute confiante": a regressão logística dá probabilidade alta à categoria mais
comum mesmo para um texto que não se parece com nada do treino (uma loja nova). Por isso a
confiança também olha a EVIDÊNCIA: o quanto a descrição se parece com o exemplo mais parecido
daquela categoria (cosseno no mesmo espaço do TF-IDF). Abaixo de 0,2 de semelhança, a confiança
cai na mesma proporção; acima, fica a probabilidade.

Um modelo por CARTEIRA, nunca do lar inteiro: o app só pergunta aos modelos das carteiras que a
pessoa vê, e um modelo de uma carteira só sabe o que está nela (o mesmo cuidado do histórico,
ADR-007). Os modelos ficam num volume do servidor (ML_MODEL_DIR), nunca na imagem nem no Git.
"""

from __future__ import annotations

import math
import os
import re
import tempfile
import threading
import time
import unicodedata
import uuid
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
from scipy.sparse import csr_matrix
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import FeatureUnion, Pipeline

VERSAO = 1  # muda quando o formato do modelo muda: modelo antigo é ignorado até o próximo treino
MIN_EXEMPLOS = 20
MIN_CATEGORIAS = 2
MAX_EXEMPLOS = 10_000
MAX_DESCRICAO = 200
MAX_CANDIDATOS = 5
# Semelhança mínima com algum exemplo da categoria para valer a probabilidade inteira
MIN_EVIDENCIA = 0.2
TIPOS = ("expense", "income")

# Ruído de banco que não diz nada da categoria (o mesmo espírito do merchantKey do app)
_RUIDO = {"compra", "cartao", "pag", "pgto", "pagto", "deb", "cred", "br", "lj", "parc"}


class ClassificadorErro(Exception):
    def __init__(self, codigo: str):
        super().__init__(codigo)
        self.codigo = codigo


def palavras(descricao: str) -> str:
    """A descrição sem acento, minúscula, sem números e sem o ruído de banco."""
    texto = unicodedata.normalize("NFKD", descricao)
    texto = "".join(c for c in texto if not unicodedata.combining(c)).lower()
    texto = re.sub(r"[^a-z0-9]+", " ", texto)
    return " ".join(p for p in texto.split() if not any(c.isdigit() for c in p) and p not in _RUIDO)


def preparar(descricao: str, tipo: str) -> str:
    """O texto que o modelo vê: as palavras e o tipo (despesa ou receita) como uma palavra a
    mais, que ajuda a separar "estorno" de "compra" sem misturar as categorias dos dois tipos.
    """
    return f"{palavras(descricao)} tipo{tipo}"


def _pipeline() -> Pipeline:
    return Pipeline(
        [
            (
                "texto",
                FeatureUnion(
                    [
                        ("palavras", TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True)),
                        (
                            "pedacos",
                            TfidfVectorizer(
                                analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True
                            ),
                        ),
                    ]
                ),
            ),
            ("modelo", LogisticRegression(C=20.0, max_iter=2000)),
        ]
    )


@dataclass(frozen=True)
class Exemplo:
    descricao: str
    tipo: str
    categoria: str


@dataclass
class Modelo:
    pipeline: Pipeline
    exemplos: int
    categorias: int
    treinado_em: float
    # Os exemplos no espaço do TF-IDF (sem o tipo) e a categoria de cada um: a evidência
    vetores: csr_matrix
    rotulos: np.ndarray
    versao: int = VERSAO

    def probabilidades(self, descricao: str, tipo: str) -> dict[str, float]:
        linha = self.pipeline.predict_proba([preparar(descricao, tipo)])[0]
        return {str(c): float(p) for c, p in zip(self.pipeline.classes_, linha, strict=True)}

    def evidencias(self, descricao: str) -> dict[str, float]:
        """A maior semelhança (0 a 1) da descrição com um exemplo de cada categoria."""
        vetor = self.pipeline.named_steps["texto"].transform([palavras(descricao)])
        # Cada parte do FeatureUnion vem normalizada (norma 1): o cosseno é o produto / 2
        semelhancas = np.asarray((self.vetores @ vetor.T).todense()).ravel() / 2
        saida: dict[str, float] = {}
        for rotulo, valor in zip(self.rotulos, semelhancas, strict=True):
            if valor > saida.get(str(rotulo), -1.0):
                saida[str(rotulo)] = float(valor)
        return saida

    def pontuar(self, descricao: str, tipo: str) -> dict[str, float]:
        """A confiança de cada categoria (0 a 1): a probabilidade, cortada sem evidência."""
        evidencias = self.evidencias(descricao)
        return {
            categoria: prob * min(1.0, evidencias.get(categoria, 0.0) / MIN_EVIDENCIA)
            for categoria, prob in self.probabilidades(descricao, tipo).items()
        }


def treinar(exemplos: list[Exemplo]) -> Modelo:
    if len(exemplos) > MAX_EXEMPLOS:
        raise ClassificadorErro("CLASSIFIER_TOO_MANY_EXAMPLES")
    categorias = {e.categoria for e in exemplos}
    if len(exemplos) < MIN_EXEMPLOS or len(categorias) < MIN_CATEGORIAS:
        raise ClassificadorErro("CLASSIFIER_TOO_FEW_EXAMPLES")
    pipeline = _pipeline()
    pipeline.fit([preparar(e.descricao, e.tipo) for e in exemplos], [e.categoria for e in exemplos])
    vetores = csr_matrix(
        pipeline.named_steps["texto"].transform([palavras(e.descricao) for e in exemplos])
    )
    rotulos = np.array([e.categoria for e in exemplos])
    return Modelo(pipeline, len(exemplos), len(categorias), time.time(), vetores, rotulos)


def confianca(probabilidade: float) -> int:
    """0,926 -> 92 (para baixo: 79,9 % nunca vira 80)."""
    return max(0, min(100, math.floor(probabilidade * 100 + 1e-9)))


def candidatos(modelos: dict[str, Modelo], descricao: str, tipo: str) -> list[dict[str, str | int]]:
    """As categorias mais prováveis somando o que cada modelo diz (a maior probabilidade vence)."""
    melhor: dict[str, tuple[float, str]] = {}
    for nome, modelo in modelos.items():
        for categoria, probabilidade in modelo.pontuar(descricao, tipo).items():
            if categoria not in melhor or probabilidade > melhor[categoria][0]:
                melhor[categoria] = (probabilidade, nome)
    ordem = sorted(melhor.items(), key=lambda item: (-item[1][0], item[0]))[:MAX_CANDIDATOS]
    return [
        {"categoria": categoria, "confianca": confianca(prob), "modelo": nome}
        for categoria, (prob, nome) in ordem
    ]


def nome_valido(nome: str) -> bool:
    """O nome do modelo é o id da carteira (uuid): nada de caminho vindo de fora."""
    try:
        return str(uuid.UUID(nome)) == nome.lower() and len(nome) == 36
    except ValueError:
        return False


class Armazem:
    """Os modelos no disco (um arquivo por carteira), com uma cópia em memória.

    Escrita atômica (arquivo temporário + rename): quem lê no meio de um treino vê o modelo
    antigo ou o novo, nunca um pela metade. Só este serviço escreve na pasta.
    """

    def __init__(self, pasta: Path):
        self.pasta = pasta
        self._memoria: dict[str, tuple[float, Modelo]] = {}
        self._trava = threading.Lock()

    def _arquivo(self, nome: str) -> Path:
        if not nome_valido(nome):
            raise ClassificadorErro("CLASSIFIER_BAD_MODEL_ID")
        return self.pasta / f"{nome.lower()}.joblib"

    def gravar(self, nome: str, modelo: Modelo) -> None:
        destino = self._arquivo(nome)
        self.pasta.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=self.pasta, suffix=".tmp", delete=False) as tmp:
            joblib.dump(modelo, tmp)
        os.replace(tmp.name, destino)
        with self._trava:
            self._memoria.pop(nome.lower(), None)

    def apagar(self, nome: str) -> None:
        self._arquivo(nome).unlink(missing_ok=True)
        with self._trava:
            self._memoria.pop(nome.lower(), None)

    def ler(self, nome: str) -> Modelo | None:
        arquivo = self._arquivo(nome)
        try:
            quando = arquivo.stat().st_mtime
        except FileNotFoundError:
            return None
        with self._trava:
            guardado = self._memoria.get(nome.lower())
            if guardado and guardado[0] == quando:
                return guardado[1]
        modelo = joblib.load(arquivo)
        if not isinstance(modelo, Modelo) or modelo.versao != VERSAO:
            return None
        with self._trava:
            self._memoria[nome.lower()] = (quando, modelo)
        return modelo


def armazem_padrao() -> Armazem:
    # Produção: /data/modelos (volume do Compose). Desenvolvimento: services/ml/.modelos
    padrao = Path(__file__).resolve().parents[1] / ".modelos"
    return Armazem(Path(os.environ.get("ML_MODEL_DIR", str(padrao))))
