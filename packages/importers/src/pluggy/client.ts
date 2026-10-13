// Cliente HTTP da API da Pluggy (usada pelo Meu Pluggy, gratuito para uso pessoal).
//
//   POST /auth  { clientId, clientSecret }  → { apiKey }   a chave vale 2 horas
//   GET  …      cabeçalho X-API-KEY: <apiKey>
//
// Segurança (ADR-011):
//   - o Client Secret só existe na memória enquanto a sincronização roda; nunca vai para log,
//     erro, auditoria ou navegador. Os erros carregam só o código e "MÉTODO caminho → status";
//   - a resposta crua nunca é registrada (pode ter nome, CPF, descrições);
//   - tempo limite em toda chamada; 429 e 5xx viram erro com código, sem repetir em laço.
import { parseExactJson, type ExactJson } from "../exact-json";
import { ProviderError } from "../provider";

export const PLUGGY_API_URL = "https://api.pluggy.ai";

/** O mínimo de fetch que o cliente usa (o fetch do Node, ou um falso nos testes). */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>;

export type PluggyCredentials = { clientId: string; clientSecret: string };

export type PluggyClientOptions = {
  credentials: PluggyCredentials;
  baseUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** Relógio (testes) */
  now?: () => number;
};

/** A chave da Pluggy vale 2 horas; renovamos com folga, depois de 1h50. */
const API_KEY_TTL_MS = 110 * 60 * 1000;

export class PluggyClient {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private apiKey: { value: string; expiresAt: number } | null = null;

  constructor(private readonly options: PluggyClientOptions) {
    this.baseUrl = (options.baseUrl ?? PLUGGY_API_URL).replace(/\/+$/, "");
    this.fetchFn = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.now = options.now ?? Date.now;
  }

  /** Troca Client ID e Client Secret por uma chave (POST /auth). Recusa = PROVIDER_AUTH_FAILED. */
  async authenticate(): Promise<void> {
    const response = await this.send(
      "POST",
      "/auth",
      {
        "content-type": "application/json",
      },
      JSON.stringify({
        clientId: this.options.credentials.clientId,
        clientSecret: this.options.credentials.clientSecret,
      }),
    );
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new ProviderError("PROVIDER_AUTH_FAILED", `POST /auth → ${response.status}`);
    }
    const body = await this.readBody("POST /auth", response);
    const apiKey = body && typeof body === "object" && !Array.isArray(body) ? body.apiKey : null;
    if (typeof apiKey !== "string" || apiKey.length < 10) {
      throw new ProviderError("PROVIDER_BAD_RESPONSE", "POST /auth sem apiKey");
    }
    this.apiKey = { value: apiKey, expiresAt: this.now() + API_KEY_TTL_MS };
  }

  /** GET com a chave. Uma chave expirada (401) é renovada uma vez. */
  async get(pathAndQuery: string): Promise<ExactJson> {
    if (!this.apiKey || this.apiKey.expiresAt <= this.now()) await this.authenticate();
    let response = await this.send("GET", pathAndQuery, { "x-api-key": this.apiKey?.value ?? "" });
    if (response.status === 401) {
      await this.authenticate();
      response = await this.send("GET", pathAndQuery, { "x-api-key": this.apiKey?.value ?? "" });
    }
    const route = `GET ${pathAndQuery.split("?")[0]}`;
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError("PROVIDER_AUTH_FAILED", `${route} → ${response.status}`);
    }
    if (response.status === 404) throw new ProviderError("PROVIDER_NOT_FOUND", `${route} → 404`);
    return this.readBody(route, response);
  }

  private async send(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<{ status: number; text(): Promise<string> }> {
    try {
      return await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers: { accept: "application/json", ...headers },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      // Rede, DNS, tempo esgotado. A mensagem original pode ter a URL com parâmetros: fora.
      throw new ProviderError(
        "PROVIDER_UNAVAILABLE",
        `${method} ${path.split("?")[0]} sem resposta`,
      );
    }
  }

  private async readBody(route: string, response: { status: number; text(): Promise<string> }) {
    if (response.status === 429) throw new ProviderError("PROVIDER_RATE_LIMITED", `${route} → 429`);
    if (response.status >= 500)
      throw new ProviderError("PROVIDER_UNAVAILABLE", `${route} → ${response.status}`);
    if (response.status < 200 || response.status >= 300) {
      throw new ProviderError("PROVIDER_BAD_RESPONSE", `${route} → ${response.status}`);
    }
    try {
      return parseExactJson(await response.text());
    } catch {
      throw new ProviderError("PROVIDER_BAD_RESPONSE", `${route} → JSON inválido`);
    }
  }
}
