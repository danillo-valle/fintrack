"""A API do classificador (M10.1): token, pedido validado, treino, sugestão e apagar."""

import uuid

import pytest
from fastapi.testclient import TestClient

from app import classificador as clf
from app.main import app

from .test_api import FonteFalsa, token

CARTEIRA = str(uuid.UUID(int=10))
OUTRA = str(uuid.UUID(int=11))


@pytest.fixture
def cliente(tmp_path):
    app.state.chaves = FonteFalsa()
    app.state.modelos = clf.Armazem(tmp_path / "modelos")
    yield TestClient(app)
    app.state.chaves = None
    app.state.modelos = None


def auth(tok: str | None = None) -> dict:
    return {"authorization": f"Bearer {tok or token()}"}


def treino(modelo: str = CARTEIRA, n: int = 12) -> dict:
    exemplos = [
        {
            "descricao": f"SUPERMERC BOM PRECO {i:02d}/10",
            "tipo": "expense",
            "categoria": "c-mercado",
        }
        for i in range(n)
    ] + [
        {"descricao": f"POSTO ESTRELA LJ {i:04d}", "tipo": "expense", "categoria": "c-posto"}
        for i in range(n)
    ]
    return {"modelo": modelo, "exemplos": exemplos}


def test_tudo_pede_token(cliente):
    assert cliente.post("/v1/classificador/treinar", json=treino()).status_code == 401
    pergunta = {"modelos": [CARTEIRA], "descricao": "x", "tipo": "expense"}
    assert cliente.post("/v1/classificador/sugerir", json=pergunta).status_code == 401
    assert cliente.delete(f"/v1/classificador/{CARTEIRA}").status_code == 401
    assert cliente.get("/v1/classificador/avaliacao").status_code == 401
    vencido = token(exp=1)
    assert cliente.post(
        "/v1/classificador/sugerir", json=pergunta, headers=auth(vencido)
    ).json() == {"code": "UNAUTHORIZED"}


def test_treina_sugere_e_apaga(cliente):
    resposta = cliente.post("/v1/classificador/treinar", json=treino(), headers=auth())
    assert resposta.status_code == 200
    assert resposta.json() == {"modelo": CARTEIRA, "exemplos": 24, "categorias": 2}

    pergunta = {"modelos": [CARTEIRA, OUTRA], "descricao": "PAG* POSTO ESTRELA", "tipo": "expense"}
    candidatos = cliente.post("/v1/classificador/sugerir", json=pergunta, headers=auth()).json()[
        "candidatos"
    ]
    assert candidatos[0]["categoria"] == "c-posto"
    assert candidatos[0]["modelo"] == CARTEIRA  # a OUTRA não tem modelo: ignorada

    assert cliente.delete(f"/v1/classificador/{CARTEIRA}", headers=auth()).status_code == 204
    vazio = cliente.post("/v1/classificador/sugerir", json=pergunta, headers=auth()).json()
    assert vazio == {"candidatos": []}


def test_poucos_exemplos_recusa_e_apaga_o_modelo_antigo(cliente):
    assert (
        cliente.post("/v1/classificador/treinar", json=treino(), headers=auth()).status_code == 200
    )
    poucos = cliente.post("/v1/classificador/treinar", json=treino(n=3), headers=auth())
    assert (poucos.status_code, poucos.json()) == (422, {"code": "CLASSIFIER_TOO_FEW_EXAMPLES"})
    assert app.state.modelos.ler(CARTEIRA) is None


@pytest.mark.parametrize(
    "corpo",
    [
        {"modelo": "../../etc", "exemplos": []},
        {"modelo": CARTEIRA, "exemplos": [{"descricao": "", "tipo": "expense", "categoria": "c"}]},
        {
            "modelo": CARTEIRA,
            "exemplos": [{"descricao": "x" * 201, "tipo": "expense", "categoria": "c"}],
        },
        {"modelo": CARTEIRA, "exemplos": [{"descricao": "x", "tipo": "outro", "categoria": "c"}]},
        "não é json",
    ],
)
def test_pedido_fora_do_formato(cliente, corpo):
    resposta = (
        cliente.post("/v1/classificador/treinar", content=corpo, headers=auth())
        if isinstance(corpo, str)
        else cliente.post("/v1/classificador/treinar", json=corpo, headers=auth())
    )
    assert (resposta.status_code, resposta.json()) == (422, {"code": "CLASSIFIER_BAD_REQUEST"})


def test_sugerir_recusa_modelo_que_nao_e_uuid(cliente):
    pergunta = {"modelos": ["../x"], "descricao": "POSTO", "tipo": "expense"}
    resposta = cliente.post("/v1/classificador/sugerir", json=pergunta, headers=auth())
    assert resposta.status_code == 422


def test_avaliacao_devolve_os_numeros_gravados(cliente):
    dados = cliente.get("/v1/classificador/avaliacao", headers=auth()).json()
    assert dados["limiar"] == 80 and dados["acerto"] >= dados["minimo"]


def test_descricao_nunca_vai_para_o_log(cliente, caplog):
    caplog.set_level("DEBUG")
    cliente.post("/v1/classificador/treinar", json=treino(), headers=auth())
    pergunta = {"modelos": [CARTEIRA], "descricao": "SEGREDO PADARIA", "tipo": "expense"}
    cliente.post("/v1/classificador/sugerir", json=pergunta, headers=auth())
    texto = caplog.text + " ".join(str(r.__dict__) for r in caplog.records)
    assert "SUPERMERC" not in texto and "SEGREDO" not in texto
