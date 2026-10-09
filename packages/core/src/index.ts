// @fintrack/core: as regras puras do FinTrack (dinheiro, datas, cartão, permissões,
// lançamentos, categorização, CSV e "pago por").
// Sem banco, sem rede, sem React: só funções que recebem valores e devolvem valores.
// Por isso são testadas sem subir nada, em milissegundos, e reaproveitadas pelo app,
// pelo seed e, no M09, pelos importadores.
export * from "./money";
export * from "./dates";
export * from "./card";
export * from "./access";
export * from "./categorization";
export * from "./transactions";
export * from "./csv";
export * from "./payer";
