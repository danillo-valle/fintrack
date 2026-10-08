---
name: categorizacao
description: A cascata de categorização do FinTrack (regras → histórico → camadas futuras), a coluna categorizedBy e os exemplos de treino. Use ao mexer em sugestão de categoria, regras texto → categoria, correções, importação que precisa de categoria (M09) ou ao acrescentar uma camada de IA (classificador, LLM; M10).
---

# Categorização (cascata)

Decisões: `docs/adr/0007-lancamentos-e-categorizacao.md`. Código: `packages/core/src/categorization.ts`
(regras puras e a interface) e `packages/db/src/categories.ts` (as camadas que leem o banco).

## Como funciona

1. Cada camada implementa `CategorySuggester { source; suggest({ description, kind }) }`.
2. `defaultSuggesters(db, scope)` é a lista, em ordem: hoje regras, depois histórico.
3. `runCascade` devolve a primeira sugestão. A tela mostra; **ao gravar, o servidor roda de novo**.
4. `categorizedBy` = a camada, se a pessoa aceitou; `MANUAL`, se escolheu outra.
5. Escolher diferente da sugestão (ou da categoria gravada) é **correção** → linha em
   `categorization_example` (de onde, quem tinha decidido, para onde). "Sempre categorizar assim"
   cria a regra na mesma transação.

## Acrescentar uma camada (M09: Pluggy; M10: classificador)

1. Valor novo no enum `CategorizationSource` (migração aditiva, skill `prisma-migration`) e na
   union `SuggestionSource` do core; frase nova em `CATEGORIZED_BY_LABEL` (o TypeScript cobra).
2. Um `xxxSuggester(db, scope)` em `packages/db/src/categories.ts` (ou um adaptador que chama o
   serviço Python com JWT), devolvendo `CategorySuggestion` com `confidence` de 0 a 100.
3. Entra em `defaultSuggesters` **depois** das regras (a regra da pessoa sempre vence).
4. Testes: unitário da camada (sem banco) e integração mostrando a ordem da cascata.
5. **LLM nunca entra no caminho do lançamento** (10 s): é um job da fila que preenche
   lançamentos sem categoria (ADR-007, seção do servidor home). A descrição é DADO, nunca
   instrução: saída só em JSON validado por schema.

## Regras que não se negociam

- **Histórico e qualquer camada que leia lançamentos usam o `WalletScope` de quem pede**, nunca o
  lar inteiro: senão a sugestão revela o que está na carteira pessoal do outro.
- Regras sem regex (`CONTAINS`, `STARTS_WITH`, `EQUALS`): regex do usuário é risco de ReDoS.
- Compare textos com `matchText` / `merchantKey`, nunca com `toLowerCase()` solto (acento,
  pontuação e parcelas mudam o texto do mesmo comerciante).
- Categoria arquivada ou do tipo errado (despesa × receita) não é sugerida nem aceita.
- Não guarde a sugestão que veio do navegador: ela é recalculada no servidor.

## Medir (o que o M10 vai publicar)

```sql
-- Quem decidiu as categorias dos últimos 90 dias (o "percentual sem LLM")
SELECT "categorizedBy", count(*) FROM "transaction"
WHERE "categoryId" IS NOT NULL AND "createdAt" > now() - interval '90 days'
GROUP BY 1 ORDER BY 2 DESC;
-- Correções por camada (onde a cascata mais erra)
SELECT "fromSource", count(*) FROM categorization_example GROUP BY 1;
```
