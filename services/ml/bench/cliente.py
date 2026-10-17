"""Falar com o llama-server (o servidor HTTP do llama.cpp) e com o /api/health do app.

Só a biblioteca padrão (urllib): a medição não acrescenta dependência ao serviço.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field


def conferir_url(url: str) -> str:
    """Só http e https (lista permitida, nunca prefixo): nada de file:, ftp: e afins."""
    partes = urllib.parse.urlsplit(url)
    if partes.scheme not in ("http", "https") or not partes.hostname:
        raise ValueError(f"URL não permitida: {url!r}")
    return url.rstrip("/")


@dataclass
class Resposta:
    conteudo: str | None  # o texto que o modelo escreveu (o JSON)
    ms: float  # o tempo do pedido inteiro, medido aqui
    erro: str | None = None
    tempos: dict[str, float] = field(default_factory=dict)  # os "timings" do llama-server


def _post(url: str, corpo: dict, limite: float) -> dict:
    dados = json.dumps(corpo).encode()
    pedido = urllib.request.Request(  # noqa: S310 (URL conferida por conferir_url)
        url, data=dados, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(pedido, timeout=limite) as resposta:  # noqa: S310
        return json.loads(resposta.read())


def completar(base: str, corpo: dict, limite: float = 300.0) -> Resposta:
    inicio = time.perf_counter()
    try:
        dado = _post(f"{conferir_url(base)}/v1/chat/completions", corpo, limite)
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as erro:
        return Resposta(None, (time.perf_counter() - inicio) * 1000, type(erro).__name__)
    ms = (time.perf_counter() - inicio) * 1000
    try:
        conteudo = dado["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        return Resposta(None, ms, "RESPOSTA_SEM_CONTEUDO")
    tempos = {
        chave: float(valor)
        for chave, valor in (dado.get("timings") or {}).items()
        if isinstance(valor, int | float)
    }
    return Resposta(conteudo if isinstance(conteudo, str) else None, ms, None, tempos)


def obter(url: str, limite: float = 5.0) -> tuple[int, bytes]:
    """GET simples: (código HTTP, corpo). Código 0 = não respondeu."""
    try:
        with urllib.request.urlopen(conferir_url(url), timeout=limite) as resposta:  # noqa: S310
            return resposta.status, resposta.read()
    except urllib.error.HTTPError as erro:
        return erro.code, b""
    except (urllib.error.URLError, TimeoutError, OSError):
        return 0, b""


def esperar_pronto(base: str, limite: float = 600.0) -> bool:
    """O llama-server responde 503 no /health enquanto carrega o modelo e 200 quando pronto."""
    fim = time.monotonic() + limite
    while time.monotonic() < fim:
        codigo, _ = obter(f"{conferir_url(base)}/health")
        if codigo == 200:
            return True
        time.sleep(2)
    return False


def propriedades(base: str) -> dict:
    """O que o llama-server conta de si (/props): versão do build, contexto. Opcional."""
    codigo, corpo = obter(f"{conferir_url(base)}/props")
    if codigo != 200:
        return {}
    try:
        dado = json.loads(corpo)
    except ValueError:
        return {}
    saida: dict = {}
    for chave in ("build_info", "total_slots"):
        if chave in dado:
            saida[chave] = dado[chave]
    contexto = (dado.get("default_generation_settings") or {}).get("n_ctx")
    if contexto:
        saida["n_ctx"] = contexto
    return saida
