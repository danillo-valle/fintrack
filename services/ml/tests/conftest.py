"""As faturas SINTÉTICAS de samples/pdf (geradas por scripts/gerar_faturas.py)."""

from pathlib import Path

import pytest

SAMPLES = Path(__file__).resolve().parents[3] / "samples" / "pdf"


@pytest.fixture
def amostra():
    def ler(nome: str) -> bytes:
        return (SAMPLES / nome).read_bytes()

    return ler
