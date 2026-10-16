// Textos em português das permissões (M06): nomes dos papéis, motivos de recusa, eventos da
// auditoria. Funções puras, sem banco: testadas em access-messages.test.ts e usadas tanto no
// servidor quanto nos componentes do navegador.
//
// O código fala inglês (OWNER, wallet.renamed); a tela fala português. Este arquivo é a ponte.
//
// Os Record<..., string> abaixo usam os tipos do @fintrack/db: código de erro ou evento novo
// sem frase aqui vira ERRO DE COMPILAÇÃO (o import é só de tipo; nada do banco vem junto).
import type { HouseholdRole, WalletKind, WalletRole } from "@fintrack/core";
import type { AuditAction, DomainErrorCode } from "@fintrack/db";

export const WALLET_ROLE_LABEL: Record<WalletRole, string> = {
  OWNER: "Dono",
  EDITOR: "Editor",
  VIEWER: "Leitor",
};

/** O que cada papel pode fazer, numa frase (aparece ao lado do seletor de papel). */
export const WALLET_ROLE_HELP: Record<WalletRole, string> = {
  OWNER: "vê, lança, exporta e administra quem participa",
  EDITOR: "vê e lança, mas não administra nem exporta",
  VIEWER: "só vê",
};

export const HOUSEHOLD_ROLE_LABEL: Record<HouseholdRole, string> = {
  OWNER: "Dono do lar",
  MEMBER: "Membro",
};

export const WALLET_KIND_LABEL: Record<WalletKind, string> = {
  PERSONAL: "Pessoal",
  SHARED: "Compartilhada",
};

/**
 * Motivo de recusa de acesso → frase. NOT_FOUND e "sem lar" não dizem se o recurso existe.
 * Os outros só aparecem para quem já participa da carteira (sabe que ela existe).
 */
export function accessDeniedMessage(reason: string): string {
  switch (reason) {
    case "ROLE":
      return "Seu papel nesta carteira não permite essa ação.";
    case "PERSONAL_WALLET":
      return "Carteira pessoal não se compartilha. Crie uma carteira compartilhada.";
    case "ARCHIVED":
      return "Esta carteira está arquivada. Desarquive para mudar algo.";
    case "NO_HOUSEHOLD":
      return "Crie o seu lar (ou aceite um convite) antes de continuar.";
    default:
      return "Não encontramos o que você pediu.";
  }
}

const DOMAIN_ERROR_MESSAGE: Record<DomainErrorCode, string> = {
  ALREADY_IN_HOUSEHOLD:
    "Você já participa de um lar. Por enquanto, cada pessoa participa de um lar só.",
  ALREADY_MEMBER: "Essa pessoa já participa.",
  NOT_HOUSEHOLD_MEMBER: "Só pessoas do seu lar podem participar das carteiras dele.",
  NOT_A_MEMBER: "Essa pessoa não participa desta carteira.",
  LAST_OWNER: "A carteira precisa de pelo menos um dono. Promova outra pessoa a dono antes.",
  SOLE_WALLET_OWNER: "Essa pessoa é a única dona de uma carteira compartilhada.",
  CANNOT_REMOVE_SELF: "O dono do lar não pode se remover.",
  CANNOT_REMOVE_OWNER: "Outro dono do lar não pode ser removido por aqui.",
  INVITE_INVALID:
    "Este convite não vale mais: expirou, foi cancelado ou já foi usado. Peça um novo.",
  INVITE_WRONG_ACCOUNT:
    "Este convite foi enviado para outro e-mail. Entre com a conta que recebeu o convite.",
  STALE_GRANT: "Seu papel mudou enquanto você estava nesta tela. Recarregue a página.",
  ACCOUNT_ARCHIVED: "Esta conta está arquivada. Escolha outra ou desarquive em Ajustes > Contas.",
  METHOD_NOT_ALLOWED: "Essa forma de pagamento não combina com a conta escolhida.",
  CARD_NOT_ALLOWED: "Esse cartão não pode ser usado nesta conta.",
  CATEGORY_INVALID:
    "Essa categoria não serve aqui: está arquivada ou é de outro tipo (despesa × receita).",
  CATEGORY_EXISTS: "Já existe uma categoria com esse nome.",
  CATEGORY_IN_USE_AS_PARENT: "Arquive antes as subcategorias desta categoria.",
  RULE_PATTERN_INVALID: "O texto da regra precisa ter de 2 a 100 caracteres.",
  TRANSFER_READONLY:
    "Transferência não se edita: exclua (dá para desfazer) e lance de novo com os dados certos.",
  SAME_ACCOUNT: "Escolha duas contas diferentes.",
  CARD_HOLDER_OUTSIDE_HOUSEHOLD: "O portador do cartão precisa ser uma pessoa do seu lar.",
  INSTALLMENTS_NEED_CREDIT_CARD:
    'Só compra no cartão de crédito é parcelada. Escolha um cartão em "Pago com".',
  CARD_CYCLE_MISSING:
    "Este cartão não tem os dias de fechamento e vencimento. Cadastre em Ajustes > Contas e cartões.",
  INSTALLMENT_COUNT_INVALID: "Escolha de 2 a 24 parcelas.",
  BUDGET_AMOUNT_INVALID: "Informe um valor de R$ 0,00 a R$ 9.999.999,99.",
  BUDGET_LEVEL_CONFLICT:
    "Esta categoria e a de cima (ou uma de baixo) não podem ter orçado no mesmo mês. Escolha um nível.",
  BUDGET_SHARES_PERSONAL: "A divisão por pessoa só existe em ambiente compartilhado.",
  SHARES_DUPLICATED: "Cada pessoa aparece uma vez só na divisão.",
  SHARES_NEGATIVE: "A parte de cada pessoa precisa ser zero ou mais.",
  SHARES_SUM_MISMATCH: "As partes precisam somar o valor da categoria.",
  CONNECTION_KEY_MISSING:
    "O servidor ainda não tem a chave que protege as credenciais (CONNECTION_SECRET_KEYS). Avise quem cuida dele.",
  CONNECTION_SECRET_REQUIRED: "Cole o Client Secret do painel da Pluggy.",
  CONNECTION_ITEMS_LIMIT: "Informe de 1 a 5 bancos (o limite do Meu Pluggy).",
  CONNECTION_ITEM_INVALID: "Item ID só tem letras, números e hífen. Copie do painel da Pluggy.",
  CONNECTION_NOT_READY: "Conecte o Meu Pluggy antes (Ajustes › Conexões bancárias).",
  REVIEW_STALE: "Esse recebido já foi conferido. Recarregue a página para ver como ficou.",
  PAIR_NOT_ALLOWED: "Esses dois lançamentos não formam um par (valor, conta ou datas diferentes).",
  REFUND_NOT_ALLOWED:
    "Esse crédito não é estorno daquela compra (valor, loja ou prazo diferentes).",
  UNDO_EXPIRED: "Não dá mais para desfazer: o lançamento mudou depois.",
  ACCOUNT_KIND_MISMATCH:
    "Cartão do banco liga só com conta de cartão (e conta corrente, com conta corrente ou poupança).",
  ACCOUNT_ALREADY_LINKED: "Essa conta do FinTrack já está ligada a outra conta do banco.",
  IMPORT_FROM_INVALID: "A data de corte vai de 12 meses atrás até hoje.",
  PROVIDER_ACCOUNT_UNKNOWN:
    "Essa conta não veio do banco agora. Recarregue a página e escolha de novo.",
  FILE_PREVIEW_EXPIRED:
    "Essa conferência não vale mais (passou 1 hora, foi cancelada ou já foi importada). Envie o arquivo de novo.",
  FILE_ACCOUNT_KIND_MISMATCH:
    "Extrato de conta entra em conta corrente ou poupança; fatura do cartão, em cartão de crédito.",
  NOT_FOUND: "Não encontramos o que você pediu.",
};

/** Regras do domínio (DomainError.code, de @fintrack/db) → frase. */
export function domainErrorMessage(code: string, details: Record<string, unknown> = {}): string {
  // A carteira que impede a remoção vai no texto: a pessoa sabe o que resolver antes
  if (code === "SOLE_WALLET_OWNER" && Array.isArray(details.wallets)) {
    return `Essa pessoa é a única dona de: ${details.wallets.join(", ")}. Passe a posse para outra pessoa antes.`;
  }
  return DOMAIN_ERROR_MESSAGE[code as DomainErrorCode] ?? DOMAIN_ERROR_MESSAGE.NOT_FOUND;
}

/** Evento da auditoria → frase da lista "Atividade do lar". */
export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  "household.created": "criou o lar",
  "household.invite_created": "enviou um convite",
  "household.invite_revoked": "cancelou um convite",
  "household.invite_accepted": "aceitou o convite e entrou no lar",
  "household.member_removed": "removeu uma pessoa do lar",
  "wallet.created": "criou uma carteira",
  "wallet.renamed": "renomeou uma carteira",
  "wallet.archived": "arquivou uma carteira",
  "wallet.restored": "desarquivou uma carteira",
  "wallet.member_added": "adicionou alguém a uma carteira",
  "wallet.role_changed": "mudou o papel de alguém numa carteira",
  "wallet.member_removed": "tirou alguém de uma carteira",
  "wallet.member_left": "saiu de uma carteira",
  "transaction.deleted": "excluiu um lançamento",
  "transaction.restored": "desfez a exclusão de um lançamento",
  "transactions.exported": "exportou lançamentos em CSV",
  "recurrences.generated": "lançou as recorrências do mês",
  "recurrence.created": "criou uma recorrência",
  "recurrence.archived": "encerrou uma recorrência",
  "account.created": "criou uma conta",
  "account.archived": "arquivou ou desarquivou uma conta",
  "card.created": "cadastrou um cartão",
  "card.archived": "arquivou ou desarquivou um cartão",
  "card.shared_purchases_changed": "marcou ou desmarcou um cartão como de compras conjuntas",
  "installment_purchase.created": "lançou uma compra parcelada",
  "category.created": "criou uma categoria",
  "category.archived": "arquivou ou restaurou uma categoria",
  "category_rule.created": "criou uma regra de categoria",
  "category_rule.deleted": "apagou uma regra de categoria",
  "budget.set": "definiu o orçado de uma categoria",
  "budget.removed": "tirou o orçado de uma categoria",
  "budgets.copied": "copiou o orçamento do mês anterior",
  "budgets.copy_undone": "desfez a cópia do orçamento",
  "connection.saved": "salvou as credenciais do Meu Pluggy",
  "connection.accounts_linked": "ligou as contas do banco",
  "connection.sync_requested": "pediu uma busca no banco",
  "transaction.reviewed": "confirmou um recebido do banco",
  "transactions.reviewed_bulk": "confirmou recebidos do banco em lote",
  "transaction.review_undone": "desfez a confirmação de recebidos do banco",
  "transaction.paired": "juntou um recebido do banco a um lançamento",
  "transaction.pair_rejected": "recusou um par sugerido na revisão",
  "transaction.refund_linked": "ligou um estorno à compra",
  "transaction.match_undone": "desfez um par ou um estorno",
  "file.imported": "importou um extrato (OFX)",
  "classifier.trained": "treinou o classificador de categorias",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABEL[action as AuditAction] ?? action;
}
