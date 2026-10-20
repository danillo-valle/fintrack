"""Os argumentos do llama-server de PRODUÇÃO, lidos do deploy/compose.prod.yml (M10.2b).

A medição (medir-llm.sh) e o teste do log (tests/test_ia_local.py) usam esta lista: o que se
mede e o que se testa é exatamente o que roda à noite. O `command:` do serviço llm fica numa
linha só no compose, como uma lista JSON.

    uv run python -m bench.producao /models/modelo.gguf   imprime os argumentos, um por linha
    uv run python -m bench.producao --imagem              imprime a imagem (com o digest)
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

COMPOSE = Path(__file__).resolve().parents[3] / "deploy" / "compose.prod.yml"


def _bloco(compose: Path) -> str:
    texto = compose.read_text(encoding="utf-8")
    return texto[texto.index("\n  llm:\n") :]


def imagem(compose: Path = COMPOSE) -> str:
    """A imagem do llama.cpp de produção, presa pelo digest (a medida no M10.2a)."""
    linha = re.search(r"^    image: (\S+@sha256:[0-9a-f]{64})$", _bloco(compose), re.MULTILINE)
    if not linha:
        raise SystemExit("o serviço llm precisa de uma image: ...@sha256:<digest>")
    return linha.group(1)


def argumentos(modelo: str | None = None, compose: Path = COMPOSE) -> list[str]:
    """O command do serviço llm; com `modelo`, troca o caminho do -m."""
    bloco = _bloco(compose)
    linha = re.search(r"^    command: (\[.*\])$", bloco, re.MULTILINE)
    if not linha:
        raise SystemExit("o serviço llm precisa de um command: [...] numa linha só")
    args = json.loads(linha.group(1))
    if modelo is not None:
        args[args.index("-m") + 1] = modelo
    return args


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ["--imagem"]:
        print(imagem())
    else:
        print("\n".join(argumentos(argv[0] if argv else None)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
