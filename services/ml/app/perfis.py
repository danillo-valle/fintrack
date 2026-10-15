"""Perfis de fatura (M09.4, ADR-014): o que muda de um banco para outro.

O leitor é um só (fatura.py). Um perfil diz como ESTE banco escreve os rótulos ("Total desta
fatura", "Vencimento"), quais linhas não são compras (o pagamento da fatura anterior) e como
chama os encargos. O genérico cobre a maioria; um perfil novo nasce do comando
`python -m app.estrutura`, que mostra só a forma das linhas, nunca valores ou nomes.
"""

from dataclasses import dataclass, field, replace

from .texto import normalizar

# Tipos de encargo, os mesmos do app (StatementChargeKind)
IOF = "IOF"
JUROS_MORA = "LATE_INTEREST"
MULTA = "LATE_FEE"
JUROS = "REMUNERATIVE_INTEREST"
OUTRO = "OTHER"


@dataclass(frozen=True)
class Perfil:
    nome: str
    #: Texto que identifica o banco na fatura (normalizado); None = genérico
    marca: str | None = None
    instituicao: str | None = None
    vencimento: tuple[str, ...] = ("data de vencimento", "vencimento", "vence em")
    total: tuple[str, ...] = (
        "total desta fatura",
        "total da fatura",
        "total a pagar",
        "valor total",
    )
    minimo: tuple[str, ...] = ("pagamento minimo", "valor minimo", "minimo")
    fechamento: tuple[str, ...] = ("data de fechamento", "fechamento")
    #: Linhas que não viram lançamento (começo da descrição, normalizado)
    ignorar: tuple[str, ...] = ("pagamento", "pgto", "saldo anterior", "saldo em aberto")
    #: Começo da descrição -> tipo de encargo. A ordem importa: "juros de mora" antes de "juros"
    encargos: tuple[tuple[str, str], ...] = field(
        default=(
            ("iof", IOF),
            ("juros de mora", JUROS_MORA),
            ("multa", MULTA),
            ("juros", JUROS),
            ("encargos", JUROS),
        )
    )


GENERICO = Perfil(nome="genérico")

# Banco inventado dos testes e dos desenhos (samples/pdf): o modelo para o perfil do seu banco
BANCO_EXEMPLO = replace(
    GENERICO,
    nome="Banco Exemplo",
    marca="banco exemplo",
    instituicao="Banco Exemplo",
    total=("total desta fatura",),
)

PERFIS: tuple[Perfil, ...] = (BANCO_EXEMPLO,)


def escolher(texto_primeira_pagina: str) -> Perfil:
    """O perfil cujo banco aparece na primeira página; senão, o genérico."""
    alvo = normalizar(texto_primeira_pagina)
    for perfil in PERFIS:
        if perfil.marca and perfil.marca in alvo:
            return perfil
    return GENERICO


def tipo_de_encargo(perfil: Perfil, descricao: str) -> str | None:
    alvo = normalizar(descricao)
    for comeco, tipo in perfil.encargos:
        if alvo.startswith(comeco):
            return tipo
    return None


def ignorada(perfil: Perfil, descricao: str) -> bool:
    alvo = normalizar(descricao)
    return any(alvo.startswith(comeco) for comeco in perfil.ignorar)
