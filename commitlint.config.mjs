// Regras para as mensagens de commit (padrão Conventional Commits).
// Formato: tipo(escopo opcional): descrição curta no imperativo
// Exemplos: "feat(auth): adiciona login com Google", "fix: corrige soma da fatura"
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Tipos aceitos no FinTrack
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "build",
        "ci",
        "chore",
        "revert",
      ],
    ],
    // Descrições em português podem começar com letra minúscula ou maiúscula
    "subject-case": [0],
    "header-max-length": [2, "always", 100],
  },
};
