---
name: commit-e-pr
description: Como escrever commits e abrir pull requests no FinTrack. Use ao preparar um commit, sugerir mensagem de commit, criar branch ou abrir PR.
---

# Commits e pull requests

## Branch

`tipo/mNN-descricao-curta`, criada a partir da `main` atualizada.
Exemplos: `feat/m03-login-google`, `fix/m07-soma-filtro`, `chore/m01-monorepo`.

## Mensagem de commit (Conventional Commits)

```
tipo(escopo opcional): descrição no imperativo, em português, até 100 caracteres

Corpo opcional explicando o PORQUÊ, não o quê. Quebre linhas em ~72 colunas.

Refs #12
```

| Tipo     | Quando                                    |
| -------- | ----------------------------------------- |
| feat     | funcionalidade nova para o usuário        |
| fix      | correção de bug                           |
| refactor | mudança interna sem alterar comportamento |
| test     | só testes                                 |
| docs     | só documentação                           |
| build    | dependências, pnpm, Turborepo, Docker     |
| ci       | GitHub Actions                            |
| chore    | manutenção que não se encaixa acima       |
| perf     | melhoria de desempenho                    |
| style    | formatação, sem mudança de lógica         |

Escopos comuns: `web`, `auth`, `db`, `ui`, `ml`, `deps`, `lint`.

Um commit = uma mudança lógica. Se a descrição precisa de "e", provavelmente são dois commits.

## Pull request

1. Título no mesmo formato do commit (vira a mensagem do squash).
2. Preencha o template: o que muda, por quê, como testou, riscos.
3. `Closes #N` para fechar a issue automaticamente no merge.
4. Só faça merge com CI verde, usando squash.

## Nunca

- Commitar direto na `main`.
- Usar `--no-verify` para pular os hooks, exceto no teste de bloqueio do M01.
- Incluir `.env`, extratos, faturas ou dumps de banco.
