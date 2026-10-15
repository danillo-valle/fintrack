"""O contrato com o app: a resposta gravada em packages/importers/fixtures/pdf é exatamente o que
o leitor produz hoje. Mudou o leitor? Regrave a resposta (comando no README do teste) e o teste
do lado TypeScript (pdf/invoice.test.ts) confere a conversão."""

import json
from pathlib import Path

from app.fatura import ler_fatura

GRAVADA = (
    Path(__file__).resolve().parents[3] / "packages/importers/fixtures/pdf/exemplo-visa-0002.json"
)


def test_resposta_gravada_igual_a_do_leitor(amostra):
    assert ler_fatura(amostra("exemplo-visa-0002.pdf")) == json.loads(GRAVADA.read_text())
