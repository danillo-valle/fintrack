"""Gera o conjunto rotulado SINTÉTICO do classificador (M10.1): samples/categorizacao/rotulado.csv.

Uso (na pasta services/ml):  uv run python scripts/gerar_rotulado.py [outro-caminho.csv]
(com um caminho, grava lá: é assim que o check confere que o arquivo do Git é o do gerador)

Tudo aqui é inventado: comerciantes de mentira, com o ruído que os bancos põem na descrição
(prefixos de compra, data, parcela, número de loja, cidade). Nada vem de extrato de ninguém.
O sorteio usa uma semente fixa: rodar de novo gera o mesmo arquivo, byte a byte.

Formato: CSV com ";" (como o Excel em português), cabeçalho "descricao;tipo;categoria", tipo
"expense" ou "income" (os mesmos nomes do app) e a categoria pelo nome.
"""

import csv
import random
import sys
from pathlib import Path

SAIDA = Path(__file__).resolve().parents[3] / "samples" / "categorizacao" / "rotulado.csv"
SEMENTE = 2026
POR_CATEGORIA = 20

# categoria -> (tipo, comerciantes inventados). Os nomes de comerciante se repetem entre o
# treino e o teste só às vezes: o sorteio decide, como na vida (a mesma padaria volta, uma
# farmácia nova aparece).
CATEGORIAS: dict[str, tuple[str, list[str]]] = {
    "Mercado": (
        "expense",
        [
            "SUPERMERC BOM PRECO",
            "MERCADINHO SAO JORGE",
            "ATACADAO DO POVO",
            "SUPERMERCADO FAMILIA",
            "HIPER CENTRAL",
            "MERCADO DA VILA",
            "EMPORIO NATURAL",
        ],
    ),
    "Restaurantes": (
        "expense",
        [
            "RESTAURANTE SABOR CASEIRO",
            "CANTINA NONNA ROSA",
            "BURGUER DO ZE",
            "PIZZARIA FORNO A LENHA",
            "SUSHI KAIZEN",
            "COMIDA APP *PEDIDO",
            "CHURRASCARIA GAUCHA",
        ],
    ),
    "Padaria": (
        "expense",
        [
            "PADARIA DO BAIRRO",
            "PANIFICADORA TRIGO BOM",
            "PADARIA PAO QUENTE",
            "CONFEITARIA DOCE LAR",
            "PADARIA SANTA LUZIA",
        ],
    ),
    "Combustível": (
        "expense",
        [
            "POSTO ESTRELA",
            "AUTO POSTO RODOVIA",
            "POSTO BANDEIRA AZUL",
            "POSTO CENTRAL COMBUSTIVEIS",
            "AUTO POSTO PRIMAVERA",
        ],
    ),
    "Farmácia": (
        "expense",
        [
            "FARMACIA CENTRAL",
            "DROGARIA SAUDE TOTAL",
            "FARMACIA POPULAR DO BAIRRO",
            "DROGARIA VIDA",
            "FARMA BEM ESTAR",
        ],
    ),
    "Assinaturas": (
        "expense",
        [
            "STREAMFLIX",
            "MUSICAFY PREMIUM",
            "NUVEM DRIVE 2TB",
            "CLUBE DO LIVRO DIGITAL",
            "VIDEOMAX ASSINATURA",
        ],
    ),
    "Transporte por app": (
        "expense",
        [
            "MOVI APP *VIAGEM",
            "RODA CAR *CORRIDA",
            "VAI JA TRANSPORTES",
            "MOVI APP *VIAGEM PIX",
        ],
    ),
    "Energia": (
        "expense",
        [
            "COMPANHIA LUZ E FORCA",
            "ENERGIA DO SUL DISTRIB",
            "CIA ENERGETICA REGIONAL",
        ],
    ),
    "Internet e telefone": (
        "expense",
        [
            "FIBRA VELOZ INTERNET",
            "TELEFONIA ONDA MOVEL",
            "CONECTA NET BANDA LARGA",
            "ONDA MOVEL RECARGA",
        ],
    ),
    "Vestuário": (
        "expense",
        [
            "LOJA MODA URBANA",
            "CALCADOS PASSO CERTO",
            "MAGAZINE ESTILO",
            "BOUTIQUE ALINHAVO",
            "JEANS & CIA",
        ],
    ),
    "Eletrônicos": (
        "expense",
        [
            "LOJA ALFA ELETRO",
            "INFO MEGA STORE",
            "CELULAR TOP ACESSORIOS",
            "GAMES E CIA",
        ],
    ),
    "Pets": (
        "expense",
        [
            "PET SHOP AMIGO FIEL",
            "CLINICA VET BICHO FELIZ",
            "RACOES PATINHAS",
            "BANHO E TOSA AU AU",
        ],
    ),
    "Salário": (
        "income",
        [
            "SALARIO EMPRESA EXEMPLO LTDA",
            "PAGTO SALARIO EXEMPLO SA",
            "CRED SALARIO FOLHA",
            "PROVENTOS EMPRESA MODELO",
        ],
    ),
    "Rendimentos": (
        "income",
        [
            "RENDIMENTO POUPANCA",
            "REND PAGO APLIC AUT",
            "RENDIMENTOS CDB",
            "JUROS SOBRE CAPITAL",
        ],
    ),
    "Reembolso": (
        "income",
        [
            "PIX RECEBIDO REEMBOLSO",
            "ESTORNO COMPRA",
            "REEMBOLSO DESPESA VIAGEM",
            "DEVOLUCAO VALOR",
        ],
    ),
}

PREFIXOS = ["", "", "", "COMPRA CARTAO ", "PAG*", "DEB ", "PIX ", "COMPRA "]
CIDADES = ["", "", "CURITIBA BR", "SAO PAULO BR", "PORTO ALEGRE", "BELO HORIZONTE"]


def descricao(sorteio: random.Random, comerciante: str, tipo: str) -> str:
    partes: list[str] = []
    if tipo == "expense":
        partes.append(sorteio.choice(PREFIXOS).strip())
    partes.append(comerciante)
    extra = sorteio.random()
    if extra < 0.25:
        partes.append(f"{sorteio.randint(1, 28):02d}/{sorteio.randint(1, 12):02d}")
    elif extra < 0.4 and tipo == "expense":
        total = sorteio.randint(2, 12)
        partes.append(f"PARC {sorteio.randint(1, total):02d}/{total:02d}")
    elif extra < 0.55:
        partes.append(f"LJ {sorteio.randint(1, 9999):04d}")
    partes.append(sorteio.choice(CIDADES))
    texto = " ".join(p for p in partes if p)
    # Às vezes o banco manda em minúsculas ou corta o fim
    if sorteio.random() < 0.15:
        texto = texto.title()
    if sorteio.random() < 0.1:
        texto = texto[: max(12, len(texto) - sorteio.randint(3, 8))]
    return texto


def gerar() -> list[tuple[str, str, str]]:
    sorteio = random.Random(SEMENTE)
    linhas: list[tuple[str, str, str]] = []
    for categoria, (tipo, comerciantes) in CATEGORIAS.items():
        vistas: set[str] = set()
        while len(vistas) < POR_CATEGORIA:
            texto = descricao(sorteio, sorteio.choice(comerciantes), tipo)
            if texto not in vistas:
                vistas.add(texto)
                linhas.append((texto, tipo, categoria))
    return linhas


def main() -> None:
    saida = Path(sys.argv[1]) if len(sys.argv) > 1 else SAIDA
    saida.parent.mkdir(parents=True, exist_ok=True)
    with saida.open("w", encoding="utf-8", newline="") as arquivo:
        escritor = csv.writer(arquivo, delimiter=";", lineterminator="\n")
        escritor.writerow(["descricao", "tipo", "categoria"])
        escritor.writerows(gerar())
    print(f"{saida.name}: {len(CATEGORIAS) * POR_CATEGORIA} descrições sintéticas")


if __name__ == "__main__":
    main()
