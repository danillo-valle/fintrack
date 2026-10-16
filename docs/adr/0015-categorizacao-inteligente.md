# ADR-015: Categorização inteligente: a categoria do banco e o classificador

- Status: aceita
- Data: 2026-10-16
- Módulo: M10.1 (desenho no canvas, linha F)

## Contexto

A cascata do M07 (ADR-007) tem duas camadas: as **regras** do lar e o **histórico** das carteiras
que a pessoa vê. O que elas não resolvem fica sem categoria, e a pessoa escolhe à mão. O M09
trouxe dois sinais novos: a **categoria que o banco manda** (Meu Pluggy, gravada em
`providerCategory` desde o M09.1) e os **exemplos de treino** que cada correção grava. O ADR-007
já previa um classificador e, por último, um LLM só numa fila assíncrona, depois de medir.

Restrições de sempre: só grátis; nada real no Git, nos testes ou nos desenhos; descrição de
lançamento nunca em log nem fora do servidor; a sugestão só lê as carteiras que quem pede vê;
os 10 s do lançamento (M07); Prisma 7 com migração aditiva; WCAG 2.2 AA; visual igual ao canvas.

Combinado com o Danillo antes do código (16/10/2026, as recomendações e o canvas F aprovados):

1. **LLM**: local no N150 só depois das medições do ADR-007 (M10.2); até lá, nenhum. API paga ou
   que treina com os dados: fora.
2. **Treino**: numa fila diária; o modelo num volume da produção, nunca no Git, no kit ou numa
   imagem.
3. **Limiar**: 0,80. Abaixo dele, sem sugestão (no M10.2, a fila do LLM).
4. **A categoria do banco** entra depois do histórico e antes do classificador.
5. **Resumo do mês** no Início (M10.3).
6. **Conjunto rotulado sintético** de ~300 descrições; acerto mínimo de 85 % no eval do CI.

O M10 foi dividido: **M10.1** (este ADR: banco, classificador, percentual sem IA, conjunto e
eval), **M10.2** (LLM local assíncrono depois das medições, teto e interruptor) e **M10.3**
(resumo do mês).

## Decisão

### A cascata

1. **Regras → histórico → banco → classificador**, todas atrás da mesma interface
   (`CategorySuggester`). Cada camada ganhou `explain`: além da sugestão, diz por que não
   sugeriu ("1 lançamento parecido (precisa de 2)", "Restaurantes ficou em 61 % (sugere a partir
   de 80 %)"). `explainCascade` dá a resposta camada por camada para a tela "Por que essa
   categoria?"; as camadas depois da que decidiu nem são perguntadas ("Não precisou").
2. **Banco (`PROVIDER`)**: o texto do banco não é uma categoria do lar. Primeiro vale o que a
   pessoa já escolheu para o mesmo texto do banco (votos nas carteiras que ela vê, as mesmas
   regras do histórico: 2 votos e 60 %); sem votos, uma categoria do lar com o mesmo nome
   (singular ou plural, sem acento) com confiança 80. "Supermercados" não vira "Mercado" por
   adivinhação.
3. **Classificador (`CLASSIFIER`)**: TF-IDF de palavras (1 e 2) e de pedaços de 3 a 5 letras,
   regressão logística (scikit-learn), no serviço Python (`services/ml`, ADR-014). A
   probabilidade é a confiança; abaixo de 80, a camada não sugere.
4. **Trava contra o "chute confiante"**: a regressão logística dá probabilidade alta à categoria
   mais comum até para uma loja que não se parece com nada do treino. A confiança também olha a
   **evidência** (o cosseno da descrição com o exemplo mais parecido daquela categoria): abaixo de
   0,2, a confiança cai na mesma proporção. Medido no conjunto sintético: o acerto não muda, e
   uma loja nova deixa de receber "Mercado 94 %".
5. **`categorizationConfidence`** (coluna nova, 0 a 100) guarda a confiança da camada aceita. CHECK:
   só com uma camada automática, nunca com `MANUAL`. A confiança acompanha o par juntado e o
   "Desfazer" (M09.2).
6. A sugestão que alimenta histórico, banco e treino é a mesma (`votingWhere`): recebido que a
   própria cascata categorizou e ninguém conferiu **não vota nem treina** (senão um erro se
   reforçaria sozinho). O que a pessoa escolheu ou confirmou vale.

### Um modelo por carteira

7. O modelo da carteira X aprende só com X e só responde a quem vê X: `classifierSuggester`
   pergunta apenas pelos modelos das carteiras do `WalletScope` de quem pede (nem chama o serviço
   se não houver nenhum). Um modelo do lar inteiro revelaria, pela sugestão, onde a outra pessoa
   compra na carteira pessoal dela (o canal lateral do histórico, ADR-007). Os modelos de várias
   carteiras somam pela maior probabilidade.
8. **Treino**: `trainWallet` junta até 10 mil exemplos da carteira (do mais recente), calcula a
   impressão digital (SHA-256) e só treina se mudou; menos de 20 exemplos ou uma categoria só
   apaga o modelo (melhor nenhuma sugestão que uma velha). Depois de treinar, os recebidos da
   carteira ainda sem categoria ganham a sugestão do classificador (continuam esperando revisão).
   Carteira arquivada perde o modelo.
9. **Quando**: a fila do pg-boss (M09.1) agenda `classifier-train-daily` às **03:15** de São
   Paulo (antes do backup das 03:30), todas as carteiras, uma por vez. "Treinar agora" em Ajustes ›
   Categorização treina as carteiras que a pessoa vê (crachá `manage_categories`, auditoria
   `classifier.trained` só com contagens).
10. **Onde fica**: o serviço grava `<id da carteira>.joblib` em `ML_MODEL_DIR` (produção:
    volume `ml-modelos` montado em `/data/modelos`; o resto do container continua só leitura).
    Escrita atômica (temporário + rename). O nome do arquivo é um uuid conferido (nada de caminho
    vindo de fora). A tabela `classifier_model` guarda só o que a tela mostra (quando, quantos
    exemplos e categorias, a impressão digital). O volume fica fora do backup: o treino da
    madrugada refaz tudo a partir do banco.
11. **API do serviço** (rede interna, token curto do Better Auth como no PDF; a fila assina com
    `sub = fintrack:fila`): `POST /v1/classificador/treinar`, `POST /v1/classificador/sugerir`,
    `DELETE /v1/classificador/<id>`, `GET /v1/classificador/avaliacao`. JSON validado (pydantic),
    corpo lido na memória com limite, treino numa thread (a sugestão de quem digita não espera).
    O log leva só códigos e contagens: **nenhuma descrição**, nem no erro.
12. **Tempo**: a sugestão tem 1,5 s (o critério dos 10 s do M07). Serviço fora ou lento: a
    camada some, a cascata segue com as outras, e o lançamento nunca falha por causa dela. A
    importação de arquivo roda a cascata **antes** da transação do banco (a transação não espera
    a rede).

### A medida: "categorizado sem IA"

13. Em Ajustes › Categorização: dos lançamentos conferidos dos últimos 30 dias nas carteiras
    que a pessoa vê (fora transferências, excluídos e o que espera revisão), quantos a cascata
    categorizou sozinha **sem IA** (regras, histórico, banco, classificador), com a parte de
    cada camada, a da pessoa (`MANUAL`, inclusive categoria antiga sem autor) e os sem
    categoria. Cada número leva à lista (`?quem=regra|historico|banco|classificador|voce`, o
    mesmo `whereOf` da lista, provado por teste de integração). Porcentagem em décimos inteiros
    (`tenthsOf`), sem float no core.
14. **README**: o acerto, a cobertura no limiar ("resolvido sem LLM") e o acerto no que foi
    resolvido, medidos no conjunto sintético, num bloco gerado por `python -m app.avaliar
--gravar`. Um teste do pytest refaz a conta e falha se o README ou o `app/avaliacao.json`
    estiverem velhos. O número real de cada casa fica na tela, nunca no Git.

### O conjunto rotulado e o eval

15. `samples/categorizacao/rotulado.csv`: 300 descrições **inventadas** (15 categorias, 20 cada),
    geradas por `services/ml/scripts/gerar_rotulado.py` com semente fixa (o mesmo arquivo a cada
    execução), com o ruído que os bancos põem (prefixos, data, parcela, loja, cidade, cortes,
    caixa). Divisão 70/30 por categoria, com semente fixa.
16. **Eval no CI**: o passo "Avaliação do classificador" do job `qualidade` (todo pull request,
    portanto todo PR que toca `services/ml`) falha abaixo de 85 %. O pytest repete a conta.
    Resultado do M10.1: acerto 94,4 %, 87,8 % resolvido sem LLM, 100 % de acerto nesses.

### Telas (linha F do canvas)

17. A etiqueta **SourcePill** (ícone + nome da camada + confiança; a cor nunca é o único sinal)
    na categoria dos recebidos e no seletor de categoria. "Por que essa categoria?" num modal de
    rota por cima da revisão (página inteira no acesso direto), com "Confirmar <categoria>"
    (volta com o "Desfazer") e "Escolher outra". Ajustes › Categorização com o percentual, a
    barra e a lista por camada, o classificador (treinado, acerto, limiar, "Treinar agora") e o
    cartão "IA local: ainda não existe (M10.2)".

## Consequências

- O que o lar categoriza toda noite melhora o dia seguinte, sem nada sair do servidor e sem
  custo.
- A imagem `fintrack-ml` cresce (scikit-learn, numpy, scipy), mas continua sem dado de ninguém:
  o CI confere a pasta de modelos vazia e nenhum `rotulado*` dentro da imagem.
- O serviço Python passa a ter estado (o volume dos modelos). Perder o volume só tira as
  sugestões do classificador até a madrugada seguinte.
- O laboratório não tem Docker: imagem e compose são provados no CI do pull request.

## Diferenças conscientes do canvas

- "Por que essa categoria?" no computador abre em **modal** por cima da revisão (o padrão do
  "Confirmar o par", M09.2), não num painel fixo ao lado da lista; no celular, o painel que sobe
  da base, como no canvas (da altura dos outros modais do app).
- O título da medida é "Categorizados **automaticamente**, sem IA", e a lista tem a linha "Você
  escolheu" (o canvas não mostrava a escolha da pessoa). O numerador (soma de quatro camadas) não
  é link; o total e cada camada são.
- O cartão "IA local" não tem o interruptor: ele chega com o LLM, no M10.2.
- Não há a aba "Na fila da IA" nos recebidos (M10.2).

## Alternativas consideradas

- **Um modelo do lar inteiro**: mais exemplos, mas vaza a carteira pessoal pela sugestão. Fora.
- **O serviço lendo o Postgres direto**: mais simples para treinar, mas o serviço passaria a ter
  a senha do banco e acesso a tudo. O app manda só os exemplos da carteira.
- **Modelo no banco (bytea)**: backup automático, mas o banco passaria a carregar um binário que
  o app não lê. O volume é refeito toda noite.
- **Calibrar só com C menor (regularização)**: derrubou a cobertura no conjunto sintético (de
  88 % para 52 % com C = 5) e ainda dava 82 % a uma loja nova. A trava da evidência resolveu sem
  perder cobertura.
