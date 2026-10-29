// Um FinTrack de mentira, pequeno, numa pasta temporária: só os arquivos que cada teste precisa,
// nos mesmos caminhos do de verdade. Nada aqui vem do repositório real.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function makeRepo(files: Record<string, string>): { root: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), "flow-map-"));
  const all: Record<string, string> = {
    "packages/db/package.json": JSON.stringify({
      name: "@fintrack/db",
      exports: { ".": "./src/index.ts" },
    }),
    "packages/core/package.json": JSON.stringify({
      name: "@fintrack/core",
      exports: { ".": "./src/index.ts" },
    }),
    "packages/db/prisma/schema/schema.prisma": "",
    ...files,
  };
  for (const [rel, text] of Object.entries(all)) {
    const file = path.join(root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
