// Cabeçalhos de segurança (M05): a CSP com nonce protege de verdade e não quebra nenhuma tela.
//
// Duas perguntas, uma por bloco:
//   1. Cada página manda a CSP, o nonce muda a cada visita e os cabeçalhos fixos estão lá?
//   2. Nenhuma página do app dispara uma violação de CSP ao carregar (um script do próprio app
//      bloqueado = tela quebrada em produção)? E um script injetado É bloqueado?
//
// Roda no pnpm dev (CI) e também contra a imagem de produção (PLAYWRIGHT_PRODUCTION=1, manual
// do M05), onde a CSP é a mais rígida: sem 'unsafe-eval'.
import { expect, test, type Page } from "@playwright/test";
import { NO_SESSION, openPage, PAGES, PUBLIC_PAGES } from "./helpers";

/** Guarda na página toda violação de CSP que o navegador relatar, desde o primeiro byte. */
async function recordCspViolations(page: Page) {
  await page.addInitScript(() => {
    const store: string[] = [];
    (window as unknown as { __cspViolations: string[] }).__cspViolations = store;
    document.addEventListener("securitypolicyviolation", (event) => {
      store.push(`${event.violatedDirective} bloqueou ${event.blockedURI || "inline"}`);
    });
  });
}

function cspViolations(page: Page) {
  return page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);
}

/** Tira o nonce do cabeçalho Content-Security-Policy. */
function nonceFrom(csp: string | undefined): string | undefined {
  return /'nonce-([^']+)'/.exec(csp ?? "")?.[1];
}

test.describe("cabeçalhos em toda página", () => {
  test.use({ storageState: NO_SESSION });

  for (const path of PUBLIC_PAGES) {
    test(`${path} manda CSP com nonce e os cabeçalhos fixos`, async ({ page }) => {
      const response = await openPage(page, path);
      const headers = response?.headers() ?? {};

      const nonce = nonceFrom(headers["content-security-policy"]);
      expect(nonce, "CSP sem nonce").toBeTruthy();
      expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
      // O mesmo nonce precisa estar nos <script> do HTML: é assim que o navegador os aceita
      expect(await response?.text()).toContain(`nonce="${nonce}"`);

      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["x-frame-options"]).toBe("DENY");
      expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(headers["permissions-policy"]).toContain("camera=()");
      // poweredByHeader: false no next.config.ts
      expect(headers["x-powered-by"]).toBeUndefined();
    });
  }

  test("o nonce muda a cada visita", async ({ request }) => {
    const first = await request.get("/entrar");
    const second = await request.get("/entrar");
    const a = nonceFrom(first.headers()["content-security-policy"]);
    const b = nonceFrom(second.headers()["content-security-policy"]);
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});

test.describe("nenhuma tela é quebrada pela CSP", () => {
  // Com a sessão da conta de teste
  for (const path of PAGES) {
    test(`${path} carrega sem violação de CSP`, async ({ page }) => {
      await recordCspViolations(page);
      await openPage(page, path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await cspViolations(page)).toEqual([]);
    });
  }

  test.describe("sem sessão", () => {
    test.use({ storageState: NO_SESSION });
    for (const path of PUBLIC_PAGES) {
      test(`${path} carrega sem violação de CSP`, async ({ page }) => {
        await recordCspViolations(page);
        await openPage(page, path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(await cspViolations(page)).toEqual([]);
      });
    }
  });

  test("HTML injetado com código não roda (simulação de XSS)", async ({ page }) => {
    await recordCspViolations(page);
    await openPage(page, "/");
    // Simula o XSS mais comum: um texto do usuário (a descrição de um lançamento, por exemplo)
    // que alguém conseguiu fazer virar HTML na página, com um "onerror" que roda JavaScript.
    // Observação: um script criado por JavaScript JÁ confiável roda de propósito ('strict-dynamic'
    // passa a confiança adiante); por isso o teste usa HTML, que é o que um atacante consegue injetar.
    const ran = await page.evaluate(async () => {
      const box = document.createElement("div");
      box.innerHTML = '<img src="/nao-existe.png" onerror="window.__invadido = true">';
      document.body.append(box);
      await new Promise((resolve) => setTimeout(resolve, 300));
      return (window as unknown as { __invadido?: boolean }).__invadido === true;
    });
    expect(ran, "o código injetado rodou: a CSP não protegeu").toBe(false);
    expect(await cspViolations(page)).toEqual([
      expect.stringMatching(/^script-src(-elem|-attr)? bloqueou inline$/),
    ]);
  });
});

test.describe("/api/health", () => {
  test.use({ storageState: NO_SESSION });

  test("responde 200 com o banco ok e sem cache", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    const body = (await response.json()) as {
      status: string;
      version: string;
      checks: { database: { status: string; latencyMs: number } };
    };
    expect(body.status).toBe("ok");
    expect(body.checks.database.status).toBe("ok");
    expect(body.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(body.version).toBeTruthy();
  });
});
