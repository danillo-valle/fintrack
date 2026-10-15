"""O leitor da fatura do cartão em PDF (M09.4, ADR-014).

Do PDF saem só os tipos do FinTrack: datas civis ("AAAA-MM-DD"), dinheiro em texto decimal exato
e os 4 últimos dígitos do cartão. O número inteiro, se o PDF trouxer, é lido e descartado aqui.
O arquivo e a senha só existem na memória, durante esta função.

    ler_fatura(bytes, senha) -> Fatura (dict pronto para o JSON)   ou   FaturaErro(código)

Como lê, linha a linha (o texto que o pdfplumber extrai de cada página):
  - lançamento: começa com a data ("08/10" ou "08/10/2026"), termina com o valor ("199,90",
    "-54,20", "54,20-"); a descrição é o meio. Compra vira valor negativo (sai dinheiro).
  - encargo: a descrição começa com IOF, juros, multa ou encargos (com ou sem data).
  - fora: pagamento da fatura anterior e saldo anterior (o perfil diz quais).
  - cabeçalho: vencimento, total, mínimo e fechamento, pelos rótulos do perfil.
O ano das datas sem ano vem do vencimento: compra de dezembro numa fatura que vence em janeiro é
do ano anterior.
"""

import io
import re
from dataclasses import dataclass

import pdfplumber
from pdfminer.pdfdocument import PDFPasswordIncorrect
from pdfminer.pdfparser import PDFSyntaxError

from .dinheiro import centavos, decimal_texto
from .perfis import Perfil, escolher, ignorada, tipo_de_encargo
from .texto import normalizar

MAX_BYTES = 5 * 1024 * 1024
MAX_PAGINAS = 30
MAX_LINHA = 300

_DATA_CURTA = re.compile(r"(\d{2})/(\d{2})(?:/(\d{2}|\d{4}))?")
_DATA_LONGA = re.compile(r"\b(\d{2})/(\d{2})/(\d{4})\b")
_FINAL = re.compile(r"\bfinal\s*(\d{4})\b")
_MASCARADO = re.compile(r"(?:[x*•]{4}[ .-]?){3}(\d{4})\b")


class FaturaErro(Exception):
    """Código estável que o app traduz (nunca dado do arquivo na mensagem)."""

    def __init__(self, codigo: str, detalhe: str = "") -> None:
        super().__init__(codigo)
        self.codigo = codigo
        self.detalhe = detalhe


@dataclass
class _Linha:
    dia: int
    mes: int
    ano: int | None
    descricao: str
    valor: int


def _data_valida(ano: int, mes: int, dia: int) -> bool:
    if not 1 <= mes <= 12 or dia < 1:
        return False
    dias = [
        31,
        29 if (ano % 4 == 0 and ano % 100 != 0) or ano % 400 == 0 else 28,
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ]
    return dia <= dias[mes - 1]


def _civil(ano: int, mes: int, dia: int) -> str:
    return f"{ano:04d}-{mes:02d}-{dia:02d}"


def _texto_das_paginas(dados: bytes, senha: str | None) -> list[str]:
    if not dados.startswith(b"%PDF-"):
        raise FaturaErro("PDF_NOT_RECOGNIZED")
    try:
        with pdfplumber.open(io.BytesIO(dados), password=senha or "") as pdf:
            if len(pdf.pages) > MAX_PAGINAS:
                raise FaturaErro("PDF_TOO_MANY_PAGES")
            return [pagina.extract_text() or "" for pagina in pdf.pages]
    except FaturaErro:
        raise
    except Exception as erro:  # o pdfplumber embrulha os erros do pdfminer (PdfminerException)
        causa = erro.args[0] if erro.args else erro
        if isinstance(causa, PDFPasswordIncorrect) or isinstance(erro, PDFPasswordIncorrect):
            codigo = "PDF_PASSWORD_WRONG" if senha else "PDF_PASSWORD_REQUIRED"
            raise FaturaErro(codigo) from erro
        if isinstance(causa, PDFSyntaxError) or isinstance(erro, PDFSyntaxError):
            raise FaturaErro("PDF_NOT_RECOGNIZED") from erro
        raise FaturaErro("PDF_NOT_RECOGNIZED", type(causa).__name__) from erro


def _lancamento(linha: str) -> _Linha | tuple[str, int] | None:
    """Uma linha de lançamento (com data) ou de encargo sem data ('IOF 13,51'); senão None."""
    tokens = linha.split()
    tokens = [t for t in tokens if t.upper() != "R$"]
    if len(tokens) < 2:
        return None
    # O sufixo de crédito pode vir separado: "54,20 -" ou "54,20 C"
    ultimo = tokens[-1]
    if ultimo.upper() in ("-", "C", "CR") and len(tokens) >= 3:
        ultimo = tokens[-2] + ultimo
        tokens = tokens[:-2]
    else:
        tokens = tokens[:-1]
    valor = centavos(ultimo)
    if valor is None:
        return None
    data = _DATA_CURTA.fullmatch(tokens[0]) if tokens else None
    if data:
        descricao = " ".join(tokens[1:])
        if not descricao:
            return None
        ano = data.group(3)
        ano_n = None if ano is None else (int(ano) + 2000 if len(ano) == 2 else int(ano))
        return _Linha(int(data.group(1)), int(data.group(2)), ano_n, descricao, valor)
    return (" ".join(tokens), valor)


def _valor_do_rotulo(linhas: list[str], normais: list[str], rotulos: tuple[str, ...]) -> int | None:
    for rotulo in rotulos:
        for i, normal in enumerate(normais):
            if rotulo not in normal or _DATA_CURTA.match(linhas[i].split()[0] if linhas[i] else ""):
                continue
            for candidata in (linhas[i], linhas[i + 1] if i + 1 < len(linhas) else ""):
                tokens = [t for t in candidata.split() if t.upper() != "R$"]
                for token in reversed(tokens):
                    valor = centavos(token)
                    if valor is not None:
                        return abs(valor)
    return None


def _data_do_rotulo(linhas: list[str], normais: list[str], rotulos: tuple[str, ...]) -> str | None:
    for rotulo in rotulos:
        for i, normal in enumerate(normais):
            if rotulo not in normal:
                continue
            for candidata in (linhas[i], linhas[i + 1] if i + 1 < len(linhas) else ""):
                m = _DATA_LONGA.search(candidata)
                if m and _data_valida(int(m.group(3)), int(m.group(2)), int(m.group(1))):
                    return _civil(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    return None


def _final_do_cartao(texto: str) -> str | None:
    alvo = normalizar(texto)
    m = _FINAL.search(alvo) or _MASCARADO.search(alvo)
    return m.group(1) if m else None


def ler_fatura(dados: bytes, senha: str | None = None) -> dict:
    """Lê a fatura. Erros: PDF_TOO_LARGE, PDF_NOT_RECOGNIZED, PDF_TOO_MANY_PAGES,
    PDF_PASSWORD_REQUIRED, PDF_PASSWORD_WRONG, PDF_NO_TEXT, PDF_NO_STATEMENT, PDF_BAD_DATA."""
    if len(dados) > MAX_BYTES:
        raise FaturaErro("PDF_TOO_LARGE")
    paginas = _texto_das_paginas(dados, senha)
    texto = "\n".join(paginas)
    if not texto.strip():
        raise FaturaErro("PDF_NO_TEXT")  # PDF escaneado (imagem): sem OCR, de propósito
    perfil: Perfil = escolher(paginas[0])

    linhas = [linha.strip()[:MAX_LINHA] for linha in texto.splitlines() if linha.strip()]
    normais = [normalizar(linha) for linha in linhas]
    vencimento = _data_do_rotulo(linhas, normais, perfil.vencimento)
    total = _valor_do_rotulo(linhas, normais, perfil.total)
    if vencimento is None or total is None:
        raise FaturaErro("PDF_NO_STATEMENT")
    minimo = _valor_do_rotulo(linhas, normais, perfil.minimo)
    fechamento = _data_do_rotulo(linhas, normais, perfil.fechamento)
    ano_venc, mes_venc = int(vencimento[:4]), int(vencimento[5:7])

    lancamentos: list[dict] = []
    encargos: dict[str, int] = {}
    ignoradas = 0
    for numero, linha in enumerate(linhas, start=1):
        achado = _lancamento(linha)
        if achado is None:
            continue
        if isinstance(achado, tuple):
            descricao, valor = achado
            tipo = tipo_de_encargo(perfil, descricao)
            if tipo:  # encargo sem data ("IOF 13,51")
                encargos[tipo] = encargos.get(tipo, 0) + valor
            continue
        tipo = tipo_de_encargo(perfil, achado.descricao)
        if tipo:
            encargos[tipo] = encargos.get(tipo, 0) + achado.valor
            continue
        if ignorada(perfil, achado.descricao):
            ignoradas += 1
            continue
        ano = achado.ano or (ano_venc if achado.mes <= mes_venc else ano_venc - 1)
        if not _data_valida(ano, achado.mes, achado.dia):
            raise FaturaErro("PDF_BAD_DATA", f"linha {numero}: data")
        lancamentos.append(
            {
                "occurredOn": _civil(ano, achado.mes, achado.dia),
                "description": achado.descricao,
                # Na fatura, compra é positiva; no FinTrack, compra é saída (negativa)
                "amount": decimal_texto(-achado.valor),
            }
        )

    datas = sorted(lan["occurredOn"] for lan in lancamentos)
    return {
        "kind": "CREDIT_CARD",
        "profile": perfil.nome,
        "institution": perfil.instituicao,
        "lastFour": _final_do_cartao(texto),
        "dueDate": vencimento,
        "closingDate": fechamento,
        "total": decimal_texto(total),
        "minimum": None if minimo is None else decimal_texto(minimo),
        "charges": [{"kind": k, "amount": decimal_texto(v)} for k, v in encargos.items()],
        "period": {"from": datas[0], "to": datas[-1]} if datas else None,
        "transactions": lancamentos,
        "skipped": ignoradas,
    }
