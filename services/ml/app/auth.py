"""Quem pode chamar o serviço (M09.4, ADR-014): só o app, em nome de uma pessoa logada.

O app assina um token curto (2 minutos) com o plugin jwt do Better Auth. Aqui o token é
conferido pela chave pública que o próprio app publica (JWKS em /api/auth/jwks): assinatura
EdDSA, emissor "fintrack", público "fintrack-ml" e validade. Sem token válido: 401.
Nenhum segredo é compartilhado entre os dois: o serviço só conhece chaves públicas.
"""

import os
from typing import Protocol

import jwt

ISSUER = "fintrack"
AUDIENCE = "fintrack-ml"
ALGORITHMS = ["EdDSA"]


class FonteDeChaves(Protocol):
    def get_signing_key_from_jwt(self, token: str) -> jwt.PyJWK: ...


def fonte_padrao() -> FonteDeChaves:
    url = os.environ.get("ML_JWKS_URL", "http://127.0.0.1:3000/api/auth/jwks")
    # As chaves ficam 5 minutos em memória; uma chave nova (kid desconhecido) busca de novo
    return jwt.PyJWKClient(url, cache_keys=True, lifespan=300, timeout=5)


class TokenInvalido(Exception):
    pass


def conferir(token: str, chaves: FonteDeChaves) -> str:
    """Devolve o id da pessoa (sub) ou lança TokenInvalido (sem dizer o porquê para fora)."""
    try:
        chave = chaves.get_signing_key_from_jwt(token)
        dados = jwt.decode(
            token,
            chave.key,
            algorithms=ALGORITHMS,
            audience=AUDIENCE,
            issuer=ISSUER,
            options={"require": ["exp", "iat", "sub", "iss", "aud"]},
            leeway=5,
        )
    except (jwt.PyJWTError, jwt.PyJWKClientError) as erro:
        raise TokenInvalido(type(erro).__name__) from erro
    sub = dados.get("sub")
    if not isinstance(sub, str) or not sub:
        raise TokenInvalido("sub")
    return sub
