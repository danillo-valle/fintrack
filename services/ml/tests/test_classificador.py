"""O classificador (M10.1): preparo do texto, treino, confiança, modelos por carteira e o disco."""

import uuid

import pytest

from app import classificador as clf

CARTEIRA_A = str(uuid.UUID(int=1))
CARTEIRA_B = str(uuid.UUID(int=2))


def exemplos(*grupos: tuple[str, list[str]], tipo: str = "expense") -> list[clf.Exemplo]:
    return [clf.Exemplo(texto, tipo, categoria) for categoria, textos in grupos for texto in textos]


MERCADO = [f"SUPERMERC BOM PRECO {n:02d}/10" for n in range(1, 12)]
POSTO = [f"POSTO ESTRELA LJ {n:04d}" for n in range(1, 12)]


def test_preparar_tira_acento_numero_e_ruido_e_marca_o_tipo():
    assert clf.preparar("COMPRA CARTÃO Padaria São João 02/10 PARC 01/03", "expense") == (
        "padaria sao joao tipoexpense"
    )
    assert clf.preparar("Estorno compra", "income") == "estorno tipoincome"


def test_confianca_arredonda_para_baixo():
    assert clf.confianca(0.7999) == 79
    assert clf.confianca(0.8) == 80
    assert clf.confianca(1.0) == 100
    assert clf.confianca(0.0) == 0


def test_treina_e_sugere_o_comerciante_com_ruido_novo():
    modelo = clf.treinar(exemplos(("mercado", MERCADO), ("posto", POSTO)))
    assert (modelo.exemplos, modelo.categorias) == (22, 2)
    lista = clf.candidatos({CARTEIRA_A: modelo}, "PAG* SUPERMERC BOM PRECO CURITIBA BR", "expense")
    assert lista[0]["categoria"] == "mercado"
    assert lista[0]["modelo"] == CARTEIRA_A
    assert 0 <= lista[-1]["confianca"] <= lista[0]["confianca"] <= 100


def test_recusa_poucos_exemplos_ou_uma_categoria_so():
    with pytest.raises(clf.ClassificadorErro, match="CLASSIFIER_TOO_FEW_EXAMPLES"):
        clf.treinar(exemplos(("mercado", MERCADO[:5]), ("posto", POSTO[:5])))
    with pytest.raises(clf.ClassificadorErro, match="CLASSIFIER_TOO_FEW_EXAMPLES"):
        clf.treinar(exemplos(("mercado", MERCADO * 3)))


def test_dois_modelos_a_maior_probabilidade_vence_e_diz_de_qual_carteira_veio():
    farmacia = [f"FARMACIA CENTRAL {n:02d}/10" for n in range(1, 12)]
    padaria = [f"PADARIA DO BAIRRO LJ {n:04d}" for n in range(1, 12)]
    so_mercado = clf.treinar(exemplos(("mercado", MERCADO), ("farmacia", farmacia)))
    so_posto = clf.treinar(exemplos(("posto", POSTO), ("padaria", padaria)))
    lista = clf.candidatos(
        {CARTEIRA_A: so_mercado, CARTEIRA_B: so_posto}, "POSTO ESTRELA", "expense"
    )
    assert lista[0] == {**lista[0], "categoria": "posto", "modelo": CARTEIRA_B}
    assert len({c["categoria"] for c in lista}) == len(lista)  # cada categoria uma vez


def test_nome_do_modelo_so_uuid():
    assert clf.nome_valido(CARTEIRA_A)
    assert clf.nome_valido(CARTEIRA_A.upper())
    sem_hifen = CARTEIRA_A.replace("-", "")
    outras_formas = [f"{{{CARTEIRA_A}}}", f"urn:uuid:{CARTEIRA_A}", sem_hifen]
    for ruim in ["../etc/passwd", "a" * 36, CARTEIRA_A.upper() + "x", "", f"{CARTEIRA_A}/x"]:
        assert not clf.nome_valido(ruim)
    for ruim in outras_formas:  # o uuid.UUID aceita, o nome do modelo não
        assert not clf.nome_valido(ruim)


def test_arquivo_do_modelo_sai_do_uuid_e_fica_na_pasta(tmp_path):
    # O nome do arquivo vem do UUID já lido (CodeQL py/path-injection), não do texto que chegou:
    # em maiúsculas, a mesma carteira cai no mesmo arquivo, sempre dentro da pasta
    carteira = "5eed0000-aaaa-4bbb-8ccc-dddddddddddd"
    pasta = tmp_path / "modelos"
    armazem = clf.Armazem(pasta)
    modelo = clf.treinar(exemplos(("mercado", MERCADO), ("posto", POSTO)))
    armazem.gravar(carteira.upper(), modelo)
    assert [p.name for p in pasta.iterdir()] == [f"{carteira}.joblib"]
    assert armazem.ler(carteira).exemplos == 22
    armazem.apagar(carteira.upper())
    assert list(pasta.iterdir()) == []


def test_armazem_grava_le_troca_e_apaga(tmp_path):
    armazem = clf.Armazem(tmp_path / "modelos")
    assert armazem.ler(CARTEIRA_A) is None
    modelo = clf.treinar(exemplos(("mercado", MERCADO), ("posto", POSTO)))
    armazem.gravar(CARTEIRA_A, modelo)
    assert armazem.ler(CARTEIRA_A).exemplos == 22
    assert [p.name for p in (tmp_path / "modelos").iterdir()] == [f"{CARTEIRA_A}.joblib"]
    # Um treino novo troca o arquivo inteiro; a leitura seguinte vê o novo
    maior = clf.treinar(exemplos(("mercado", MERCADO * 2), ("posto", POSTO)))
    armazem.gravar(CARTEIRA_A, maior)
    assert armazem.ler(CARTEIRA_A).exemplos == 33
    armazem.apagar(CARTEIRA_A)
    assert armazem.ler(CARTEIRA_A) is None
    with pytest.raises(clf.ClassificadorErro, match="CLASSIFIER_BAD_MODEL_ID"):
        armazem.ler("../fora")


def test_loja_que_nao_se_parece_com_nada_nao_ganha_confianca_alta():
    # 40 do mercado contra 12 do posto: a regressão logística "chutaria" mercado para uma loja
    # nova; sem evidência (nenhum exemplo parecido), a confiança cai abaixo do limiar
    mercado = [f"SUPERMERC BOM PRECO {n}" for n in range(40)]
    modelo = clf.treinar(exemplos(("mercado", mercado), ("posto", POSTO)))
    loja = clf.candidatos({CARTEIRA_A: modelo}, "LOJA ALFA ELETRO", "expense")[0]
    assert loja["confianca"] < 80
    conhecido = clf.candidatos({CARTEIRA_A: modelo}, "PAG* SUPERMERC BOM PRECO", "expense")[0]
    assert conhecido["categoria"] == "mercado" and conhecido["confianca"] >= 80
    assert modelo.evidencias("LOJA ALFA ELETRO")["mercado"] < clf.MIN_EVIDENCIA
