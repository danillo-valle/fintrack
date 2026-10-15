"""Gera as faturas SINTÉTICAS em PDF de samples/pdf (M09.4). Nada real: bancos inventados,
finais 0002 e 0003, valores escolhidos à mão para a conta fechar (ou não fechar, de propósito).

    uv run python scripts/gerar_faturas.py     (da pasta services/ml)

reportlab com invariant=1: o mesmo script gera sempre os mesmos bytes (o PDF com senha muda a
cada vez, porque a cifra usa um sal aleatório; o teste não compara bytes).
"""

import io
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

SAIDA = Path(__file__).resolve().parents[3] / "samples" / "pdf"

COMPRAS = [
    ("01/10", "RESTAURANTE SABOR", "54,20"),
    ("02/10", "ESTORNO RESTAURANTE SABOR", "54,20-"),
    ("04/10", "POSTO ESTRELA", "88,40"),
    ("06/10", "STREAMING GLOBAL USD 6,50", "36,00"),
    ("08/10", "LIVRARIA NOBRE PARC 04/06", "199,90"),
    ("15/10", "MERCADO BOM PRECO", "312,48"),
    ("18/10", "FARMACIA CENTRAL", "47,90"),
    ("20/10", "LOJA DE CASA", "1.200,00"),
    ("25/10", "PADARIA PAO QUENTE", "23,50"),
    ("28/10", "SUPERMERCADO CENTRAL", "141,82"),
]


def _pagina(c: canvas.Canvas, linhas: list[tuple[str, str]]) -> None:
    y = 800
    for esquerda, direita in linhas:
        c.drawString(50, y, esquerda)
        if direita:
            c.drawRightString(545, y, direita)
        y -= 18
    c.showPage()


def banco_exemplo(total: str) -> bytes:
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4, invariant=1)
    c.setFont("Helvetica", 10)
    cabecalho = [
        ("Banco Exemplo", ""),
        ("Fatura do cartão Visa", ""),
        ("Cartão XXXX XXXX XXXX 0002", ""),
        ("Data de fechamento 01/11/2026", ""),
        ("Vencimento 10/11/2026", ""),
        ("Total desta fatura", f"R$ {total}"),
        ("Pagamento mínimo", "R$ 314,03"),
        ("Saldo anterior", "2.146,35"),
        ("Lançamentos", ""),
        ("22/10 PAGAMENTO RECEBIDO", "-2.146,35"),
    ]
    _pagina(c, cabecalho + [(f"{d} {desc}", v) for d, desc, v in COMPRAS])
    _pagina(
        c,
        [
            ("Encargos", ""),
            ("IOF DE COMPRAS NO EXTERIOR", "13,51"),
            ("29/10 JUROS DO ROTATIVO", "30,00"),
            ("Total de encargos", "43,51"),
        ],
    )
    c.save()
    return buffer.getvalue()


def banco_norte() -> bytes:
    """Um banco que nenhum perfil conhece: o leitor genérico (rótulos e crédito com 'C')."""
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4, invariant=1)
    c.setFont("Helvetica", 10)
    _pagina(
        c,
        [
            ("Banco Sintético Norte", ""),
            ("Mastercard final 0003", ""),
            ("Data de vencimento: 05/01/2027", ""),
            ("Total da fatura: R$ 412,30", ""),
            ("Valor mínimo: R$ 61,85", ""),
            ("15/12 CAFE DO PORTO", "18,00"),
            ("20/12/2026 LIVRARIA DO CAIS", "120,00"),
            ("28/12 DEVOLUCAO LIVRARIA DO CAIS", "20,00 C"),
            ("03/01 FEIRA DA PRAIA", "294,30"),
        ],
    )
    c.save()
    return buffer.getvalue()


def escaneada() -> bytes:
    """Um PDF só com desenho (como uma fatura escaneada): sem texto para ler."""
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4, invariant=1)
    c.rect(50, 600, 300, 150, fill=1)
    c.showPage()
    c.save()
    return buffer.getvalue()


def com_senha(dados: bytes, senha: str) -> bytes:
    leitor = PdfReader(io.BytesIO(dados))
    escritor = PdfWriter()
    for pagina in leitor.pages:
        escritor.add_page(pagina)
    escritor.encrypt(user_password=senha, owner_password=None, algorithm="AES-256")
    saida = io.BytesIO()
    escritor.write(saida)
    return saida.getvalue()


def main() -> None:
    SAIDA.mkdir(parents=True, exist_ok=True)
    confere = banco_exemplo("2.093,51")
    arquivos = {
        "exemplo-visa-0002.pdf": confere,
        "exemplo-visa-0002-nao-confere.pdf": banco_exemplo("2.105,91"),
        "exemplo-visa-0002-senha-1234.pdf": com_senha(confere, "1234"),
        "norte-master-0003.pdf": banco_norte(),
        "escaneada.pdf": escaneada(),
    }
    for nome, dados in arquivos.items():
        (SAIDA / nome).write_bytes(dados)
        print(f"{nome}: {len(dados)} bytes")


if __name__ == "__main__":
    main()
