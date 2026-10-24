// O corpo cru de um webhook do bot, lido até um limite (M11; M12.0b: os dois canais usam). Passou
// do limite declarado ou lido: null, sem ler o resto.
import "server-only";

/** Lê o corpo cru até o limite; passou dele, null (sem ler o resto). */
export async function readLimited(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (declared > maxBytes) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
