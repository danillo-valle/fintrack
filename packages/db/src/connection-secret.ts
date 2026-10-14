// Cifragem do Client Secret do Meu Pluggy (M09.1, ADR-011).
//
// O segredo é gravado no banco CIFRADO com AES-256-GCM; a chave fica FORA do banco, na variável
// CONNECTION_SECRET_KEYS (em produção, no /srv/fintrack/app.env, com cópia no gerenciador de
// senhas). Um backup do banco sozinho, então, não revela segredo nenhum.
//
//   CONNECTION_SECRET_KEYS="2:<base64 de 32 bytes>,1:<base64 de 32 bytes>"
//                           ↑ a primeira cifra; todas decifram (troca de chave sem perder nada)
//
// Formato gravado (coluna secretCiphertext):
//   [versão da chave: 1 byte][IV: 12 bytes][etiqueta GCM: 16 bytes][texto cifrado]
//
// O id da conexão entra como "dado associado" (AAD): um segredo copiado para outra conexão no
// banco não decifra. Nenhuma mensagem de erro daqui carrega o segredo ou a chave.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type SecretKeyring = {
  /** A versão que cifra os segredos novos */
  current: number;
  keys: ReadonlyMap<number, Buffer>;
};

const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretKeyError";
  }
}

/**
 * Lê CONNECTION_SECRET_KEYS ("2:base64,1:base64"). Cada chave precisa ter 32 bytes (gere com
 * `openssl rand -base64 32`); versões de 1 a 255, sem repetir.
 */
export function parseKeyring(value: string | undefined | null): SecretKeyring {
  if (!value || value.trim() === "") throw new SecretKeyError("CONNECTION_SECRET_KEYS vazia");
  const keys = new Map<number, Buffer>();
  let current: number | null = null;
  for (const part of value.split(",")) {
    const match = /^\s*(\d{1,3}):([A-Za-z0-9+/=]+)\s*$/.exec(part);
    if (!match) throw new SecretKeyError("CONNECTION_SECRET_KEYS fora do formato versão:base64");
    const version = Number.parseInt(match[1] as string, 10);
    const key = Buffer.from(match[2] as string, "base64");
    if (version < 1 || version > 255)
      throw new SecretKeyError(`versão de chave inválida: ${version}`);
    if (key.length !== 32) throw new SecretKeyError(`a chave ${version} não tem 32 bytes`);
    if (keys.has(version)) throw new SecretKeyError(`versão de chave repetida: ${version}`);
    keys.set(version, key);
    current ??= version;
  }
  return { current: current as number, keys };
}

/** Cifra o segredo para a conexão `connectionId` com a chave atual. */
export function sealSecret(
  keyring: SecretKeyring,
  connectionId: string,
  secret: string,
): Uint8Array<ArrayBuffer> {
  const key = keyring.keys.get(keyring.current);
  if (!key) throw new SecretKeyError("chave atual ausente");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(connectionId, "utf8"));
  const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  // Uint8Array próprio (cópia): é o tipo que a coluna Bytes do Prisma recebe
  return new Uint8Array(
    Buffer.concat([Buffer.from([keyring.current]), iv, cipher.getAuthTag(), body]),
  );
}

/** Decifra. Chave errada, conexão errada ou bytes alterados: SecretKeyError (sem detalhes). */
export function openSecret(
  keyring: SecretKeyring,
  connectionId: string,
  sealed: Uint8Array,
): string {
  const data = Buffer.from(sealed);
  if (data.length < 1 + IV_BYTES + TAG_BYTES + 1)
    throw new SecretKeyError("segredo gravado curto demais");
  const version = data[0] as number;
  const key = keyring.keys.get(version);
  if (!key) throw new SecretKeyError(`a chave ${version} não está em CONNECTION_SECRET_KEYS`);
  const iv = data.subarray(1, 1 + IV_BYTES);
  const tag = data.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const body = data.subarray(1 + IV_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(connectionId, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretKeyError("o segredo não decifra com esta chave e esta conexão");
  }
}

/** Versão da chave com que o segredo foi cifrado (para saber se precisa recifrar). */
export function sealedKeyVersion(sealed: Uint8Array): number | null {
  return sealed.length > 0 ? (sealed[0] as number) : null;
}
