"""O eval do CI (M10.1): o acerto no conjunto sintético não pode cair abaixo do mínimo, e os
números gravados (app/avaliacao.json e o README) têm de ser os desta rodada."""

import json
import re

from app import avaliar


def comparavel(texto: str) -> str:
    # O Prettier alinha as colunas das tabelas do Markdown: compara sem espaços e traços extras
    texto = re.sub(r"-{3,}", "---", texto)
    linhas = (re.sub(r"[ \t]+", " ", linha).strip() for linha in texto.splitlines())
    return "\n".join(linha for linha in linhas if linha)


def test_conjunto_e_sintetico_e_do_tamanho_combinado():
    exemplos = avaliar.ler_conjunto()
    assert 280 <= len(exemplos) <= 320
    assert {e.tipo for e in exemplos} == {"expense", "income"}
    # Nada que pareça número de cartão (13 a 19 dígitos seguidos) no conjunto
    assert not any(re.search(r"\d{13,19}", e.descricao) for e in exemplos)


def test_acerto_acima_do_minimo_e_numeros_gravados_em_dia():
    resultado = avaliar.avaliar()
    assert resultado["acerto"] >= avaliar.MINIMO, (
        f"acerto {resultado['acerto']:.3f} abaixo do mínimo {avaliar.MINIMO}"
    )
    gravado = json.loads(avaliar.RESULTADO.read_text(encoding="utf-8"))
    assert gravado == resultado, "rode: uv run python -m app.avaliar --gravar (e o pnpm format)"
    readme = avaliar.README.read_text(encoding="utf-8")
    inicio, fim = readme.index(avaliar.INICIO), readme.index(avaliar.FIM) + len(avaliar.FIM)
    assert comparavel(readme[inicio:fim]) == comparavel(avaliar.bloco_readme(resultado))


def test_divisao_e_estavel_e_por_categoria():
    exemplos = avaliar.ler_conjunto()
    treino, teste = avaliar.dividir(exemplos)
    assert (len(treino), len(teste)) == (210, 90)
    assert avaliar.dividir(exemplos) == (treino, teste)
    assert {e.categoria for e in teste} == {e.categoria for e in exemplos}
