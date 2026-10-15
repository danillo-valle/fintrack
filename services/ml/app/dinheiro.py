"""Dinheiro exato, do texto da fatura até o JSON (M09.4).

A fatura escreve "2.093,51", "-54,20", "54,20-" ou "R$ 1,26". Aqui o valor vira centavos (int do
Python, que é exato e sem limite) e sai como texto decimal ("-54.20"), igual ao que o app já
lê do OFX e da Pluggy. Nunca passa por float.
"""

import re

# Sem quantificadores aninhados: linear no tamanho do texto
_NUMERO = re.compile(r"(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})")


def centavos(texto: str) -> int | None:
    """'2.093,51' -> 209351; '-54,20', '54,20-' ou '54,20 C' -> -5420. Não é valor: None."""
    t = texto.strip().upper().replace("R$", "").replace(" ", "")
    negativo = False
    if t.startswith("-"):
        negativo, t = True, t[1:]
    for sufixo in ("-", "CR", "C"):
        if t.endswith(sufixo):
            negativo, t = True, t[: -len(sufixo)]
            break
    m = _NUMERO.fullmatch(t)
    if not m:
        return None
    valor = int(m.group(1).replace(".", "")) * 100 + int(m.group(2))
    return -valor if negativo else valor


def decimal_texto(valor: int) -> str:
    """209351 -> '2093.51'; -5420 -> '-54.20'."""
    sinal = "-" if valor < 0 else ""
    absoluto = abs(valor)
    return f"{sinal}{absoluto // 100}.{absoluto % 100:02d}"
