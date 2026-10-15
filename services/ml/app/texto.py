"""Texto da fatura normalizado para comparar rótulos (sem acento, minúsculo, espaços simples)."""

import unicodedata


def normalizar(texto: str) -> str:
    sem_acento = unicodedata.normalize("NFKD", texto)
    sem_acento = "".join(c for c in sem_acento if not unicodedata.combining(c))
    return " ".join(sem_acento.lower().split())


def forma(texto: str) -> str:
    """A "forma" de uma linha, sem o conteúdo: letras viram 'a', dígitos viram '9'.

    'PADARIA 12,50' -> 'a 9,9'. Serve para afinar um perfil sem ver a fatura de ninguém.
    """
    saida: list[str] = []
    for c in texto:
        if c.isalpha():
            r = "a"
        elif c.isdigit():
            r = "9"
        elif c.isspace():
            r = " "
        else:
            r = c
        if not saida or saida[-1] != r or r not in "a9 ":
            saida.append(r)
    return "".join(saida).strip()
