"""O leitor contra as faturas sintéticas, e o que ele recusa."""

import io
import re

import pytest
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from app.dinheiro import centavos
from app.fatura import MAX_BYTES, FaturaErro, ler_fatura


def codigo(dados: bytes, senha: str | None = None) -> str:
    with pytest.raises(FaturaErro) as erro:
        ler_fatura(dados, senha)
    return erro.value.codigo


def test_banco_exemplo_cabecalho_e_perfil(amostra):
    f = ler_fatura(amostra("exemplo-visa-0002.pdf"))
    assert f["profile"] == "Banco Exemplo"
    assert f["institution"] == "Banco Exemplo"
    assert f["lastFour"] == "0002"
    assert f["dueDate"] == "2026-11-10"
    assert f["closingDate"] == "2026-11-01"
    assert f["total"] == "2093.51"
    assert f["minimum"] == "314.03"
    assert f["period"] == {"from": "2026-10-01", "to": "2026-10-28"}


def test_banco_exemplo_compras_creditos_encargos_e_pagamento(amostra):
    f = ler_fatura(amostra("exemplo-visa-0002.pdf"))
    assert len(f["transactions"]) == 10
    assert f["skipped"] == 1  # o pagamento da fatura anterior
    por_descricao = {t["description"]: t["amount"] for t in f["transactions"]}
    assert por_descricao["LIVRARIA NOBRE PARC 04/06"] == "-199.90"
    assert por_descricao["ESTORNO RESTAURANTE SABOR"] == "54.20"  # crédito entra positivo
    assert por_descricao["STREAMING GLOBAL USD 6,50"] == "-36.00"  # o valor é o do fim da linha
    assert f["charges"] == [
        {"kind": "IOF", "amount": "13.51"},
        {"kind": "REMUNERATIVE_INTEREST", "amount": "30.00"},
    ]


def test_a_conta_fecha_ao_centavo(amostra):
    f = ler_fatura(amostra("exemplo-visa-0002.pdf"))
    compras = -sum(centavos(t["amount"].replace(".", ",")) for t in f["transactions"])
    encargos = sum(centavos(c["amount"].replace(".", ",")) for c in f["charges"])
    assert compras + encargos == centavos(f["total"].replace(".", ","))


def test_banco_desconhecido_usa_o_generico_e_acerta_o_ano(amostra):
    f = ler_fatura(amostra("norte-master-0003.pdf"))
    assert f["profile"] == "genérico"
    assert f["institution"] is None
    assert f["lastFour"] == "0003"
    assert f["dueDate"] == "2027-01-05"
    datas = [t["occurredOn"] for t in f["transactions"]]
    # Dezembro numa fatura que vence em janeiro é do ano anterior; o ano escrito vale
    assert datas == ["2026-12-15", "2026-12-20", "2026-12-28", "2027-01-03"]
    assert f["transactions"][2]["amount"] == "20.00"  # "20,00 C" é crédito


def test_senha_pedida_errada_e_certa(amostra):
    dados = amostra("exemplo-visa-0002-senha-1234.pdf")
    assert codigo(dados) == "PDF_PASSWORD_REQUIRED"
    assert codigo(dados, "0000") == "PDF_PASSWORD_WRONG"
    assert ler_fatura(dados, "1234")["total"] == "2093.51"


def test_escaneada_sem_texto(amostra):
    assert codigo(amostra("escaneada.pdf")) == "PDF_NO_TEXT"


def test_nao_e_pdf_e_tamanho():
    assert codigo(b"OFXHEADER:100") == "PDF_NOT_RECOGNIZED"
    assert codigo(b"%PDF-1.7 quebrado") == "PDF_NOT_RECOGNIZED"
    assert codigo(b"%PDF-" + b"0" * MAX_BYTES) == "PDF_TOO_LARGE"


def _pdf(linhas: list[str]) -> bytes:
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4, invariant=1)
    for i, linha in enumerate(linhas):
        c.drawString(50, 800 - 18 * i, linha)
    c.showPage()
    c.save()
    return buffer.getvalue()


def test_sem_vencimento_ou_total_nao_e_fatura():
    assert codigo(_pdf(["Banco Qualquer", "05/10 CAFE 10,00"])) == "PDF_NO_STATEMENT"


def test_numero_inteiro_do_cartao_nao_sai_do_leitor():
    inteiro = "9" * 12 + "0003"
    f = ler_fatura(
        _pdf(
            [
                f"Cartao {inteiro} final 0003",
                "Vencimento 05/11/2026",
                "Total da fatura 10,00",
                "05/10 CAFE 10,00",
            ]
        )
    )
    assert f["lastFour"] == "0003"
    assert "999999" not in repr(f)


def test_data_impossivel_e_recusada():
    dados = _pdf(["Vencimento 05/03/2026", "Total da fatura 10,00", "30/02 CAFE 10,00"])
    assert codigo(dados) == "PDF_BAD_DATA"


def test_os_samples_nao_tem_numero_de_cartao(amostra):
    for nome in ("exemplo-visa-0002.pdf", "norte-master-0003.pdf"):
        texto = repr(ler_fatura(amostra(nome)))
        assert not re.search(r"\d{13,19}", texto)
