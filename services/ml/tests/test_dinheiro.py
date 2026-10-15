import pytest

from app.dinheiro import centavos, decimal_texto


@pytest.mark.parametrize(
    ("texto", "esperado"),
    [
        ("2.093,51", 209351),
        ("R$ 1,26", 126),
        ("-54,20", -5420),
        ("54,20-", -5420),
        ("20,00C", -2000),
        ("0,00", 0),
        ("1.200.000,00", 120000000),
    ],
)
def test_le_o_valor_exato(texto, esperado):
    assert centavos(texto) == esperado


@pytest.mark.parametrize("texto", ["12.5", "1,2", "abc", "", "1.23,45", "12,345"])
def test_recusa_o_que_nao_e_valor(texto):
    assert centavos(texto) is None


def test_escreve_o_decimal_sem_float():
    assert decimal_texto(209351) == "2093.51"
    assert decimal_texto(-5) == "-0.05"
    assert decimal_texto(10**20 + 1) == "1000000000000000000.01"
