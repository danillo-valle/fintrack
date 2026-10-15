"""A API do serviço Python (M09.4, ADR-014). Roda só na rede interna; o app é o único cliente.

  GET  /health        "ok" para o healthcheck do container
  POST /v1/faturas    corpo = os bytes do PDF (application/pdf), até 5 MB
                      Authorization: Bearer <token curto do app>
                      X-Pdf-Password: a senha em base64url, só se o PDF tiver senha
                      200 = a fatura lida; 401 = token; 413 = tamanho; 422 = {"code": "PDF_..."}

O PDF e a senha nunca vão para disco nem para log: o corpo é lido na memória (sem multipart, que
grava arquivos grandes em disco) e o log só leva o código do resultado.
"""

import base64
import binascii
import logging

from fastapi import FastAPI, Header, Request
from fastapi.responses import JSONResponse

from .auth import FonteDeChaves, TokenInvalido, conferir, fonte_padrao
from .fatura import MAX_BYTES, FaturaErro, ler_fatura

log = logging.getLogger("fintrack.ml")

app = FastAPI(title="FinTrack ML", docs_url=None, redoc_url=None, openapi_url=None)
app.state.chaves = None


def _chaves() -> FonteDeChaves:
    if app.state.chaves is None:
        app.state.chaves = fonte_padrao()
    return app.state.chaves


def _erro(status: int, codigo: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": codigo})


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/v1/faturas")
async def ler(
    request: Request,
    authorization: str | None = Header(default=None),
    x_pdf_password: str | None = Header(default=None),
) -> JSONResponse:
    if not authorization or not authorization.startswith("Bearer "):
        return _erro(401, "UNAUTHORIZED")
    try:
        usuario = conferir(authorization.removeprefix("Bearer ").strip(), _chaves())
    except TokenInvalido as motivo:
        log.info("token recusado", extra={"event": "ml.unauthorized", "reason": str(motivo)})
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
