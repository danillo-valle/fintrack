"""O relatório de estrutura não deixa sair valor, nome de loja nem número."""

from app.estrutura import relatorio
from app.texto import forma


def test_forma_tira_o_conteudo():
    assert forma("08/10 PADARIA PAO QUENTE 23,50") == "9/9 a a a 9,9"


def test_relatorio_sem_conteudo(amostra):
    texto = relatorio(amostra("exemplo-visa-0002.pdf"), None)
    assert "perfil: Banco Exemplo" in texto
    assert "lançamento: 10" in texto
    assert "leitura completa: ok" in texto
    for proibido in ("PADARIA", "2.093", "2093", "0002", "312,48", "LIVRARIA"):
        assert proibido not in texto
