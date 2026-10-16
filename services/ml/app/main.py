"""A API do serviço Python (M09.4, ADR-014). Roda só na rede interna; o app é o único cliente.

  GET  /health        "ok" para o healthcheck do container
  POST /v1/faturas    corpo = os bytes do PDF (application/pdf), até 5 MB
                      Authorization: Bearer <token curto do app>
                      X-Pdf-Password: a senha em base64url, só se o PDF tiver senha
                      200 = a fatura lida; 401 = token; 413 = tamanho; 422 = {"code": "PDF_..."}

  O classificador de categorias (M10.1, ADR-015), um modelo por carteira:
  POST   /v1/classificador/treinar     {"modelo": <id da carteira>, "exemplos": [...]}
  POST   /v1/classificador/sugerir     {"modelos": [<ids>], "descricao": ..., "tipo": ...}
  DELETE /v1/classificador/<modelo>    apaga o modelo (carteira arquivada ou poucos exemplos)
  GET    /v1/classificador/avaliacao   o resultado do conjunto sintético (app/avaliacao.json)

O PDF, a senha e as descrições nunca vão para disco nem para log: o corpo é lido na memória (sem
multipart, que grava arquivos grandes em disco) e o log só leva códigos e contagens. Só o
modelo treinado vai para o disco, no volume do servidor (ML_MODEL_DIR).
"""

import base64
import binascii
import json
import logging
from pathlib import Path

from fastapi import FastAPI, Header, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ValidationError
from starlette.concurrency import run_in_threadpool

from . import classificador as clf
from .auth import FonteDeChaves, TokenInvalido, conferir, fonte_padrao
from .fatura import MAX_BYTES, FaturaErro, ler_fatura

log = logging.getLogger("fintrack.ml")

app = FastAPI(title="FinTrack ML", docs_url=None, redoc_url=None, openapi_url=None)
app.state.chaves = None
app.state.modelos = None

AVALIACAO = Path(__file__).resolve().parent / "avaliacao.json"
MAX_CORPO_JSON = 4 * 1024 * 1024  # 10 mil exemplos de até 200 caracteres cabem com folga


def _chaves() -> FonteDeChaves:
    if app.state.chaves is None:
        app.state.chaves = fonte_padrao()
    return app.state.chaves


def _modelos() -> clf.Armazem:
    if app.state.modelos is None:
        app.state.modelos = clf.armazem_padrao()
    return app.state.modelos


def _erro(status: int, codigo: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": codigo})


def _quem(authorization: str | None) -> str | None:
    """O id de quem chama (sub do token) ou None: sem token válido, 401."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    try:
        return conferir(authorization.removeprefix("Bearer ").strip(), _chaves())
    except TokenInvalido as motivo:
        log.info("token recusado", extra={"event": "ml.unauthorized", "reason": str(motivo)})
        return None


async def _json(request: Request) -> object | None:
    """O corpo JSON, lido na memória com limite de tamanho (None se grande ou inválido)."""
    corpo = bytearray()
    async for pedaco in request.stream():
        corpo.extend(pedaco)
        if len(corpo) > MAX_CORPO_JSON:
            return None
    try:
        return json.loads(corpo)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    finally:
        corpo.clear()


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/v1/faturas")
async def ler(
    request: Request,
    authorization: str | None = Header(default=None),
    x_pdf_password: str | None = Header(default=None),
) -> JSONResponse:
    usuario = _quem(authorization)
    if usuario is None:
        return _erro(401, "UNAUTHORIZED")

    tamanho = request.headers.get("content-length")
    if tamanho is not None and (not tamanho.isdigit() or int(tamanho) > MAX_BYTES):
        return _erro(413, "PDF_TOO_LARGE")
    corpo = bytearray()
    async for pedaco in request.stream():
        corpo.extend(pedaco)
        if len(corpo) > MAX_BYTES:
            return _erro(413, "PDF_TOO_LARGE")

    senha: str | None = None
    if x_pdf_password:
        try:
            senha = base64.urlsafe_b64decode(x_pdf_password + "==").decode("utf-8")
        except (binascii.Error, UnicodeDecodeError):
            return _erro(422, "PDF_PASSWORD_WRONG")

    try:
        fatura = ler_fatura(bytes(corpo), senha)
    except FaturaErro as erro:
        log.info("fatura recusada", extra={"event": "ml.rejected", "code": erro.codigo})
        return _erro(413 if erro.codigo == "PDF_TOO_LARGE" else 422, erro.codigo)
    finally:
        corpo.clear()
        senha = None
    log.info(
        "fatura lida",
        extra={"event": "ml.read", "user": usuario, "rows": len(fatura["transactions"])},
    )
    return JSONResponse(content=fatura)


# ── O classificador (M10.1) ─────────────────────────────────────────────────────────────────

Descricao = Field(min_length=1, max_length=clf.MAX_DESCRICAO)
Tipo = Field(pattern="^(expense|income)$")
IdModelo = Field(min_length=36, max_length=36)


class ExemploEntrada(BaseModel):
    descricao: str = Descricao
    tipo: str = Tipo
    categoria: str = Field(min_length=1, max_length=64)


class Treino(BaseModel):
    modelo: str = IdModelo
    exemplos: list[ExemploEntrada] = Field(max_length=clf.MAX_EXEMPLOS)


class Pergunta(BaseModel):
    modelos: list[str] = Field(min_length=1, max_length=20)
    descricao: str = Descricao
    tipo: str = Tipo


def _validar(modelo: type[BaseModel], dados: object):
    try:
        return modelo.model_validate(dados)
    except ValidationError:
        return None


@app.post("/v1/classificador/treinar")
async def treinar(request: Request, authorization: str | None = Header(default=None)):
    if _quem(authorization) is None:
        return _erro(401, "UNAUTHORIZED")
    pedido = _validar(Treino, await _json(request))
    if pedido is None or not clf.nome_valido(pedido.modelo):
        return _erro(422, "CLASSIFIER_BAD_REQUEST")
    exemplos = [clf.Exemplo(e.descricao, e.tipo, e.categoria) for e in pedido.exemplos]
    try:
        # Treinar leva de 1 a 3 s: numa thread, para o /sugerir de quem digita não esperar
        modelo = await run_in_threadpool(clf.treinar, exemplos)
    except clf.ClassificadorErro as erro:
        # Poucos exemplos: o modelo antigo (se houver) sai, para não sugerir com dado velho
        if erro.codigo == "CLASSIFIER_TOO_FEW_EXAMPLES":
            _modelos().apagar(pedido.modelo)
        log.info("treino recusado", extra={"event": "ml.train_rejected", "code": erro.codigo})
        return _erro(422, erro.codigo)
    _modelos().gravar(pedido.modelo, modelo)
    log.info(
        "modelo treinado",
        extra={"event": "ml.trained", "examples": modelo.exemplos, "categories": modelo.categorias},
    )
    return {"modelo": pedido.modelo, "exemplos": modelo.exemplos, "categorias": modelo.categorias}


@app.post("/v1/classificador/sugerir")
async def sugerir(request: Request, authorization: str | None = Header(default=None)):
    if _quem(authorization) is None:
        return _erro(401, "UNAUTHORIZED")
    pedido = _validar(Pergunta, await _json(request))
    if pedido is None or not all(clf.nome_valido(m) for m in pedido.modelos):
        return _erro(422, "CLASSIFIER_BAD_REQUEST")
    armazem = _modelos()
    modelos = {m: modelo for m in dict.fromkeys(pedido.modelos) if (modelo := armazem.ler(m))}
    # Sem log aqui: é chamado enquanto a pessoa digita, e a descrição nunca vai para log
    return {"candidatos": clf.candidatos(modelos, pedido.descricao, pedido.tipo)}


@app.delete("/v1/classificador/{modelo}")
def apagar(modelo: str, authorization: str | None = Header(default=None)):
    if _quem(authorization) is None:
        return _erro(401, "UNAUTHORIZED")
    if not clf.nome_valido(modelo):
        return _erro(422, "CLASSIFIER_BAD_REQUEST")
    _modelos().apagar(modelo)
    log.info("modelo apagado", extra={"event": "ml.deleted"})
    return Response(status_code=204)


@app.get("/v1/classificador/avaliacao")
def avaliacao(authorization: str | None = Header(default=None)):
    if _quem(authorization) is None:
        return _erro(401, "UNAUTHORIZED")
    return json.loads(AVALIACAO.read_text(encoding="utf-8"))
