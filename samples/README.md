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

Nenhum arquivo aqui tem sequência de 13 a 19 dígitos fora das datas (o teste confere).
