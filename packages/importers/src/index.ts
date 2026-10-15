// @fintrack/importers: as fontes de dados bancários do FinTrack (M09, ADR-011). Cada fonte é um
// adaptador que implementa TransactionProvider. Veja a skill `importador` antes de criar outro.
export * from "./provider";
export { moneyFromText, parseExactJson, type ExactJson } from "./exact-json";
export {
  PluggyClient,
  PLUGGY_API_URL,
  type FetchLike,
  type PluggyCredentials,
} from "./pluggy/client";
export { PluggyProvider } from "./pluggy/adapter";
export * from "./ofx";
