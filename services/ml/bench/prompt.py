"""O prompt e o schema da sugestão por LLM: desde o M10.2b eles moram em app/ia_local.py.

A medição usa exatamente o que a fila de produção usa: este módulo só repete os nomes.
"""

from app.ia_local import (  # noqa: F401 (reexportados para o bench e os testes)
    INSTRUCOES,
    MAX_DESCRICAO,
    NENHUMA,
    TIPO_TEXTO,
    esquema,
    limpar,
    mensagens,
    pedido,
    validar,
)
