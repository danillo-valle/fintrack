// Garante a regra da skill auth-guard: toda página do grupo (app) chama requireUser().
// Se alguém criar uma página nova e esquecer, este teste falha antes do PR.
// requireRecentAuth (M07, exportar) também vale: ela chama requireUser por dentro e ainda
// exige uma prova de identidade recente (lib/auth/session.ts).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_DIR = path.join(import.meta.dirname, "(app)");

function findPages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return findPages(full);
    return name === "page.tsx" ? [full] : [];
  });
}

describe("páginas do app", () => {
  const pages = findPages(APP_DIR);

  it("existem (o teste está olhando a pasta certa)", () => {
    expect(pages.length).toBeGreaterThanOrEqual(7);
  });

  it.each(pages.map((p) => [path.relative(APP_DIR, p)]))("%s chama requireUser()", (rel) => {
    const source = readFileSync(path.join(APP_DIR, rel), "utf8");
    expect(source).toMatch(/await (requireUser\(\)|requireRecentAuth\()/);
  });
});
