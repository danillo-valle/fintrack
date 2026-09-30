---
name: fintrack-conventions
description: Convenções de código do FinTrack. Use sempre que criar, mover ou revisar arquivos em apps/ ou packages/, escolher nomes, ou decidir onde uma lógica deve ficar.
---

# Convenções do FinTrack

## Onde cada coisa fica

| O quê                                  | Onde                                                         |
| -------------------------------------- | ------------------------------------------------------------ |
| Página ou rota de API                  | `apps/web/src/app/...` (só composição; sem regra de negócio) |
| Regra de negócio de uma funcionalidade | `apps/web/src/features/<feature>/server/`                    |
| Componentes de uma funcionalidade      | `apps/web/src/features/<feature>/ui/`                        |
| Validação de entrada                   | `apps/web/src/features/<feature>/schemas.ts` (zod)           |
| Utilitário usado por várias features   | `apps/web/src/lib/`                                          |
| Regra pura reutilizável, sem I/O       | `packages/core/` (a partir do M04)                           |

Uma feature só importa outra pelo `server/index.ts` dela. Nunca importe arquivos internos de outra feature.

## Nomes

- Arquivos e pastas: `kebab-case` (`wallet-list.tsx`, `get-health.ts`).
- Componentes React: `PascalCase`. Funções e variáveis: `camelCase`. Constantes globais: `UPPER_SNAKE_CASE`.
- Identificadores em inglês, textos visíveis ao usuário em português do Brasil.
- Testes ao lado do arquivo testado: `health.ts` e `health.test.ts`.

## TypeScript

- Sem `any`. Se o tipo é desconhecido, use `unknown` e valide.
- Prefira `type` a `interface`, a menos que precise de extensão por declaração.
- Funções exportadas têm tipo de retorno explícito quando o retorno não é óbvio.
- O projeto usa `noUncheckedIndexedAccess`: `lista[0]` pode ser `undefined`; trate o caso.

## Dinheiro e datas

- Dinheiro nunca é `number` nem `parseFloat`. Até o M04, não crie cálculo monetário.
- Datas exibidas sempre no fuso `America/Sao_Paulo`; datas guardadas sempre em UTC.

## Antes de concluir

1. `pnpm check` passa sem erros.
2. Todo arquivo novo tem teste ou uma justificativa de por que não tem.
3. Nenhum arquivo fora do lugar descrito acima.
