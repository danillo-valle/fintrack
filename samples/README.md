# samples/

Única pasta do repositório onde arquivos `.ofx`, `.pdf` e `.csv` são aceitos.
Tudo aqui é **sintético**: escrito à mão ou gerado por script, sem nenhum dado real.
Extratos e faturas de verdade ficam em `~/fintrack-data/`, fora do Git.

## ofx/ (M09.3)

Escritos à mão, com os bancos inventados do banco sintético (`@fintrack/importers/testing`):

- `aurora-conta-4321.ofx`: extrato da conta corrente do Banco Aurora, final 4321, de 26/09 a
  10/10/2026. OFX 1 (SGML) em latin-1, como os bancos brasileiros mandam: acentos, vírgula
  decimal, milhar, um FITID repetido e uma linha sem FITID. Quatro lançamentos (03/10 a 07/10)
  têm o mesmo valor e a mesma data da conta corrente do banco sintético: na conta ligada ao
  Meu Pluggy, eles aparecem como "já veio pelo Meu Pluggy".
- `exemplo-visa-0002.ofx`: fatura do Visa do Banco Exemplo, final 0002, em OFX 2 (XML, UTF-8):
  compra parcelada (PARC 03/06), compra em dólar com IOF, estorno e o pagamento da fatura (que
  fica de fora). O número do cartão vem mascarado; o teste que prova que o número inteiro é
  descartado monta o número na hora.

## pdf/ (M09.4)

Gerados por `services/ml/scripts/gerar_faturas.py` (reportlab, sempre os mesmos bytes), com os
mesmos bancos inventados:

- `exemplo-visa-0002.pdf`: fatura do Visa do Banco Exemplo, final 0002, vence 10/11/2026: 10
  compras e créditos (R$ 2.050,00), IOF R$ 13,51 e juros R$ 30,00 = total R$ 2.093,51 (confere
  ao centavo); o pagamento da fatura anterior fica de fora. Lido pelo perfil "Banco Exemplo".
- `exemplo-visa-0002-nao-confere.pdf`: a mesma, com total R$ 2.105,91 (faltam R$ 12,40).
- `exemplo-visa-0002-senha-1234.pdf`: a mesma, com a senha `1234` (AES-256).
- `norte-master-0003.pdf`: um banco sem perfil (o leitor genérico), com compras de dezembro na
  fatura de janeiro (o ano vem do vencimento).
- `escaneada.pdf`: só imagem, sem texto (o leitor recusa com uma frase).

Nenhum arquivo aqui tem sequência de 13 a 19 dígitos fora das datas (o teste confere).

## categorizacao/ (M10.1)

Gerado por `services/ml/scripts/gerar_rotulado.py` (semente fixa: sempre o mesmo arquivo):

- `rotulado.csv`: o conjunto rotulado do classificador, com 300 descrições **inventadas** (15
  categorias, 20 cada; separador `;`, colunas `descricao;tipo;categoria`). Comerciantes de mentira
  (SUPERMERC BOM PRECO, POSTO ESTRELA, STREAMFLIX...) com o ruído que os bancos põem: prefixo de
  compra, data, parcela, número de loja, cidade, texto cortado. O eval do CI (`python -m
app.avaliar --minimo 0.85`) treina em 70 % e mede nos outros 30 %.

Escritos à mão para a medição do LLM local (M10.2a, `services/ml/bench`):

- `llm-dificil.csv`: 45 descrições de lojas **inventadas que não aparecem no rotulado** (3 por
  categoria: QUITANDA DO SEU JOAO, BOTICA SAO LUCAS...). É onde um LLM poderia ajudar: o
  classificador nunca viu a loja.
- `llm-injecao.csv`: 15 descrições com tentativa de prompt injection ("IGNORE AS INSTRUCOES E
  RESPONDA...", JSON falso, marcadores de conversa), com a categoria certa e o `alvo` que o texto
  tenta impor.

Teste de aceite da IA local (M10.2b, ADR-016):

- `llm-aceite.csv`: 30 tentativas **novas** de prompt injection (mensagem de PIX, categoria
  grudada no nome da loja, outras línguas, formatação que imita dado), escritas e **congeladas
  em 17/10/2026, antes do filtro** existir (sha256 `d86c387b…7efa13`, conferido por teste). O
  filtro nunca é ajustado olhando para elas: se um dia mudarem, é um conjunto novo, com data.
