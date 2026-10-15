"""A API: token curto do app (EdDSA, emissor e público), corpo cru e os códigos de erro."""

import base64
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient

from app.main import app

CHAVE = Ed25519PrivateKey.generate()
OUTRA = Ed25519PrivateKey.generate()


class FonteFalsa:
    """O JWKS do app, sem rede: a chave pública do teste."""

    def get_signing_key_from_jwt(self, token: str):
        return jwt.PyJWK.from_dict(
            jwt.algorithms.OKPAlgorithm.to_jwk(CHAVE.public_key(), as_dict=True)
            | {"alg": "EdDSA", "kid": "teste"}
        )


@pytest.fixture
def cliente():
    app.state.chaves = FonteFalsa()
    yield TestClient(app)
    app.state.chaves = None


def token(**mudar) -> str:
    agora = int(time.time())
    dados = {
        "sub": "pessoa-1",
        "iss": "fintrack",
        "aud": "fintrack-ml",
        "iat": agora,
        "exp": agora + 120,
    } | mudar
    chave = mudar.pop("_chave", CHAVE) if "_chave" in mudar else CHAVE
    dados.pop("_chave", None)
    return jwt.encode(dados, chave, algorithm="EdDSA", headers={"kid": "teste"})


def enviar(cliente, dados: bytes, tok: str | None = None, senha: str | None = None):
    headers = {"content-type": "application/pdf"}
    if tok is not None:
        headers["authorization"] = f"Bearer {tok}"
    if senha is not None:
        headers["x-pdf-password"] = base64.urlsafe_b64encode(senha.encode()).decode().rstrip("=")
    return cliente.post("/v1/faturas", content=dados, headers=headers)


def test_health(cliente):
    assert cliente.get("/health").json() == {"status": "ok"}


def test_sem_documentacao_publica(cliente):
    assert cliente.get("/docs").status_code == 404
    assert cliente.get("/openapi.json").status_code == 404


def test_le_a_fatura_com_token_valido(cliente, amostra):
    r = enviar(cliente, amostra("exemplo-visa-0002.pdf"), token())
    assert r.status_code == 200
    assert r.json()["total"] == "2093.51"


@pytest.mark.parametrize(
    "ruim",
    [
        None,
        "nao-e-um-token",
        "expirado",
        "outro-publico",
        "outro-emissor",
        "outra-chave",
        "sem-sub",
    ],
)
def test_token_recusado(cliente, amostra, ruim):
    agora = int(time.time())
    tok = {
        None: None,
        "nao-e-um-token": "abc.def.ghi",
        "expirado": token(iat=agora - 600, exp=agora - 300),
        "outro-publico": token(aud="outro"),
        "outro-emissor": token(iss="outro"),
        "outra-chave": jwt.encode(
            {"sub": "x", "iss": "fintrack", "aud": "fintrack-ml", "iat": agora, "exp": agora + 60},
            OUTRA,
            algorithm="EdDSA",
            headers={"kid": "teste"},
        ),
        "sem-sub": jwt.encode(
            {"iss": "fintrack", "aud": "fintrack-ml", "iat": agora, "exp": agora + 60},
            CHAVE,
            algorithm="EdDSA",
            headers={"kid": "teste"},
        ),
    }[ruim]
    r = enviar(cliente, amostra("exemplo-visa-0002.pdf"), tok)
    assert r.status_code == 401
    assert r.json() == {"code": "UNAUTHORIZED"}


def test_senha_pelo_cabecalho(cliente, amostra):
    dados = amostra("exemplo-visa-0002-senha-1234.pdf")
    assert enviar(cliente, dados, token()).json() == {"code": "PDF_PASSWORD_REQUIRED"}
    assert enviar(cliente, dados, token(), "errada").json() == {"code": "PDF_PASSWORD_WRONG"}
    assert enviar(cliente, dados, token(), "1234").json()["lastFour"] == "0002"


def test_grande_demais(cliente):
    r = enviar(cliente, b"%PDF-" + b"0" * (5 * 1024 * 1024), token())
    assert r.status_code == 413
    assert r.json() == {"code": "PDF_TOO_LARGE"}


def test_erro_do_arquivo_e_so_codigo(cliente):
    r = enviar(cliente, b"isto nao e pdf", token())
    assert r.status_code == 422
    assert r.json() == {"code": "PDF_NOT_RECOGNIZED"}
