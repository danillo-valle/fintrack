# Medição do LLM local (M10.2a, ADR-007)

O ADR-007 decidiu que um LLM local só entra no FinTrack **depois de medido no próprio servidor** (o
N150 de casa, com a produção no ar). Esta pasta é essa medição. Ela fica fora da imagem de produção
(o `Dockerfile` copia só `app/`) e usa só dados **sintéticos**.

```bash
services/ml/bench/medir-llm.sh --rapido qwen2.5-1.5b   # confere a montagem (uns 5 min)
services/ml/bench/medir-llm.sh qwen2.5-1.5b            # a medição completa (200 pedidos)
services/ml/bench/medir-llm.sh qwen2.5-3b
uv --directory services/ml run --frozen python -m bench.relatorio --comparar ~/fintrack-llm/resultados/*-qwen2.5-1.5b ~/fintrack-llm/resultados/*-qwen2.5-3b
```

## O que roda

| Peça           | O que faz                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| `medir-llm.sh` | baixa o modelo (sha256 conferido), sobe o llama-server num container com teto, mede e derruba             |
| `baixar.py`    | o download do Hugging Face, com o sha256 da API dele; o modelo fica em `~/fintrack-llm/modelos`           |
| `prompt.py`    | o prompt e o JSON schema (o mesmo da fila, se for aprovada) e as defesas contra prompt injection          |
| `conjuntos.py` | os itens: 90 de teste do eval, 45 lojas novas e 15 tentativas de injeção; e o que o classificador diria   |
| `cliente.py`   | o HTTP com o llama-server (`/v1/chat/completions`, `response_format` com `json_schema`) e o `/api/health` |
| `monitor.py`   | temperatura, clock, swap e memória do container (pelo cgroup), e o `/api/health` da produção a cada 1 s   |
| `medir.py`     | as fases: repouso (60 s), a 1ª passada (150 itens) e o sustentado (até 200 pedidos)                       |
| `relatorio.py` | a tabela do ADR-007 com "passa" ou "não passa" em cada linha, e a comparação dos modelos                  |
| `modelos.tsv`  | os modelos que dá para medir (repositório, arquivo, licença)                                              |

## O container do llama-server

Imagem oficial `ghcr.io/ggml-org/llama.cpp:server`, chamada pelo **digest** (fica no relatório):
`--cpus 2` (teto de núcleos), `--cpu-shares 256` (na disputa, a produção vence), `--memory 3g` com
`--memory-swap 3g` (sem swap: se faltar memória ele morre, e a medição mostra), só leitura, sem
capacidades, usuário sem privilégios, `--offline`, sem a interface web, porta só em `127.0.0.1:8090`.
Na medição ele fica na rede padrão do Docker (precisa falar com o script no host); numa fila de
verdade (M10.2b), ficaria só numa rede interna, como o `ml`.

Ajustes por variável de ambiente: `LLM_CPUS`, `LLM_THREADS`, `LLM_MEMORIA`, `LLM_CONTEXTO`,
`LLAMA_IMAGEM` e `FINTRACK_LLM_DIR` (onde ficam modelos e resultados; nunca dentro do repositório).

## As defesas contra prompt injection

1. A descrição entra como um valor dentro de um JSON (escapada) e as instruções dizem que ela é dado.
2. Os marcadores de conversa (`<|im_start|>`, `[INST]`, `<s>`...) são tirados antes.
3. A resposta é presa por um JSON schema: o llama-server o transforma numa gramática, e a categoria
   só pode ser uma da lista do tipo (ou `"nenhuma"`). `validar()` confere de novo, sem confiar no servidor.

O relatório conta em quantas das 15 tentativas o modelo escolheu o "alvo" que o texto tentava impor.

## Os testes

`tests/test_bench.py` (no `pnpm check`): o prompt, o schema, os conjuntos, o relatório e a medição de
ponta a ponta contra um llama-server **falso**. O llama-server de verdade foi testado no laboratório
com um modelo minúsculo de pesos aleatórios (mesmo formato de conversa e tokenizador do Qwen2.5):
JSON preso ao schema, cache do prompt e os `timings`.
