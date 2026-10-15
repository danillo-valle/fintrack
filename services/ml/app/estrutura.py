"""Mostra a ESTRUTURA de uma fatura, sem o conteúdo (M09.4): para afinar o perfil do seu banco.

    uv run python -m app.estrutura ~/fintrack-data/fatura.pdf            (pede a senha, se tiver)

Imprime o perfil escolhido, quais rótulos foram achados (vencimento, total, mínimo, final), quantas
linhas viraram lançamento, encargo ou ficaram de fora e a FORMA das linhas que não foram
entendidas: letras viram "a" e dígitos viram "9" ("a a 9/9 9,9"). Nenhum valor, nome de loja ou
número sai daqui: é isso que você pode me mandar.
"""

import getpass
import sys
from collections import Counter
from pathlib import Path

from .fatura import FaturaErro, _lancamento, _texto_das_paginas, ler_fatura
from .perfis import escolher, ignorada, tipo_de_encargo
from .texto import forma, normalizar


def relatorio(dados: bytes, senha: str | None) -> str:
    paginas = _texto_das_paginas(dados, senha)
    perfil = escolher(paginas[0] if paginas else "")
    linhas = [linha.strip() for linha in "\n".join(paginas).splitlines() if linha.strip()]
    saida = [
        f"perfil: {perfil.nome}",
        f"páginas: {len(paginas)}",
        f"linhas com texto: {len(linhas)}",
    ]
    for campo, rotulos in (
        ("vencimento", perfil.vencimento),
        ("total", perfil.total),
        ("mínimo", perfil.minimo),
        ("fechamento", perfil.fechamento),
    ):
        achados = [r for r in rotulos if any(r in normalizar(linha) for linha in linhas)]
        saida.append(f"rótulo de {campo}: {', '.join(achados) if achados else 'NÃO ACHADO'}")
    contagem: Counter[str] = Counter()
    estranhas: list[str] = []
    for linha in linhas:
        achado = _lancamento(linha)
        if achado is None:
            estranhas.append(forma(linha))
        elif isinstance(achado, tuple):
            contagem["encargo sem data" if tipo_de_encargo(perfil, achado[0]) else "sem data"] += 1
        elif tipo_de_encargo(perfil, achado.descricao):
            contagem["encargo"] += 1
        elif ignorada(perfil, achado.descricao):
            contagem["fora (pagamento, saldo)"] += 1
        else:
            contagem["lançamento"] += 1
    saida += [f"{nome}: {n}" for nome, n in sorted(contagem.items())]
    try:
        fatura = ler_fatura(dados, senha)
        saida.append(f"final do cartão achado: {'sim' if fatura['lastFour'] else 'não'}")
        saida.append("leitura completa: ok")
    except FaturaErro as erro:
        saida.append(f"leitura completa: {erro.codigo}")
    saida.append("formas das linhas não entendidas (as 40 mais comuns):")
    for f, n in Counter(estranhas).most_common(40):
        saida.append(f"  {n:3d}×  {f}")
    return "\n".join(saida)


def main() -> int:
    if len(sys.argv) != 2:
        print("uso: python -m app.estrutura arquivo.pdf", file=sys.stderr)
        return 2
    dados = Path(sys.argv[1]).read_bytes()
    try:
        print(relatorio(dados, None))
    except FaturaErro as erro:
        if erro.codigo != "PDF_PASSWORD_REQUIRED":
            print(f"erro: {erro.codigo}", file=sys.stderr)
            return 1
        print(relatorio(dados, getpass.getpass("Senha do PDF (não aparece): ")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
