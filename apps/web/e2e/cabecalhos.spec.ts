// Cabeçalhos de segurança (M05): a CSP com nonce protege de verdade e não quebra nenhuma tela.
//
// As perguntas, uma por bloco:
//   1. Cada página manda a CSP, o nonce muda a cada visita e os cabeçalhos fixos estão lá?
//   2. Nenhuma página do app dispara uma violação de CSP ao carregar (um script do próprio app
//      bloqueado = tela quebrada em produção)? E um script injetado É bloqueado?
//   3. (M12.1) <style> só com o nonce ou o hash exato; o CSS dos avisos aplica; style= vale.
//   4. (M12.1) Pedido de outra origem é recusado: a API do login e as Server Actions (CSRF).
//   5. (M12.1) O cookie da sessão é HttpOnly e SameSite=Lax.
//
// Roda no pnpm dev (CI) e também contra a imagem de produção (PLAYWRIGHT_PRODUCTION=1, manual
// do M05), onde a CSP é a mais rígida: sem 'unsafe-eval' e sem <style> fora do nonce e do hash.
import { expect, type Page } from "@playwright/test";
import { personWithHome } from "./bot-person";
import {
  apiHeaders,
  createTestUser,
  fakeIp,
  NO_SESSION,
  openPage,
  PAGES,
  PRODUCTION_BUILD,
  PUBLIC_PAGES,
  sql,
  test,
  testEmail,
} from "./helpers";

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

test.describe("estilos: <style> só com nonce ou hash (M12.1)", () => {
  test("um <style> injetado não aplica (o CSS que lê a página por seletor)", async ({ page }) => {
    // No pnpm dev o <style> é liberado (o Next põe o CSS das telas assim; security-headers.ts).
    // A regra de produção é provada contra o build (PLAYWRIGHT_PRODUCTION=1) e pelo teste de
    // unidade da CSP; o ZAP confere o cabeçalho da imagem no CI.
    test.skip(!PRODUCTION_BUILD, "a CSP de <style> do dev é a liberada");
    await recordCspViolations(page);
    await openPage(page, "/");
    // O ataque de CSS: um <style> que pinta (ou manda para fora, com url()) conforme o que está na
    // página. Basta conferir que a regra NÃO aplicou e que o navegador relatou o bloqueio.
    const applied = await page.evaluate(async () => {
      const box = document.createElement("div");
      box.innerHTML = "<style>body { outline: 7px solid rgb(1, 2, 3) }</style>";
      document.body.append(box);
      await new Promise((resolve) => setTimeout(resolve, 200));
      return getComputedStyle(document.body).outlineColor === "rgb(1, 2, 3)";
    });
    expect(applied, "o <style> injetado aplicou: a CSP não protegeu").toBe(false);
    expect(await cspViolations(page)).toEqual([
      expect.stringMatching(/^style-src(-elem)? bloqueou inline$/),
    ]);
  });

  test("o CSS dos avisos (sonner) aplica: o hash da CSP é o do pacote", async ({ page }) => {
    await recordCspViolations(page);
    await openPage(page, "/");
    // Bloqueado, o <style> do sonner fica na página sem nenhuma regra (cssRules vazio)
    const rules = await page.evaluate(() => {
      const sheet = [...document.styleSheets].find((s) =>
        s.ownerNode?.textContent?.includes("[data-sonner-toaster]"),
      );
      return sheet ? sheet.cssRules.length : -1;
    });
    expect(rules, "o CSS do sonner não carregou").toBeGreaterThan(0);
    expect(await cspViolations(page)).toEqual([]);
  });

  test("style= continua valendo (as barras e as cores das telas)", async ({ page }) => {
    await openPage(page, "/");
    const inline = await page.evaluate(() => {
      const box = document.createElement("div");
      box.setAttribute("style", "width: 37px");
      document.body.append(box);
      return box.getBoundingClientRect().width;
    });
    expect(inline).toBe(37);
  });
});

test.describe("pedido de outra origem é recusado (CSRF, M12.1)", () => {
  const ATTACKER = "https://atacante.example";

  test("a API de entrar e trocar a senha recusa outra origem e pedido sem origem", async ({
    request,
  }) => {
    // Um site de fora tentando entrar na conta da pessoa (ou trocar a senha dela)
    const signIn = await request.post("/api/auth/sign-in/email", {
      headers: { Origin: ATTACKER },
      data: { email: "ana@fintrack.test", password: "qualquer coisa" },
    });
    expect(signIn.status()).toBe(403);
    expect(await signIn.json()).toMatchObject({ code: "INVALID_ORIGIN" });
    // Com o cookie da sessão (o storageState da Ana) e sem Origin: recusado também
    const change = await request.post("/api/auth/change-password", {
      data: { currentPassword: "x", newPassword: "uma frase nova bem longa" },
    });
    expect(change.status()).toBe(403);
    expect(await change.json()).toMatchObject({ code: "MISSING_OR_NULL_ORIGIN" });
  });

  test("a Server Action com outra origem não roda; a MESMA, com a origem certa, roda", async ({
    page,
  }, testInfo) => {
    test.slow(); // uma pessoa com lar e duas idas ao servidor
    const person = await personWithHome(page, "csrf", testInfo.project.name);
    const saved = async () =>
      (
        await sql<{ n: string }>(
          `SELECT count(*)::text AS n FROM bot_preference p JOIN "user" u ON u.id = p."userId" WHERE u.email = $1`,
          [person.email],
        )
      )[0]!.n;

    // Captura o pedido de verdade do "Salvar padrões" (a Server Action) sem deixá-lo chegar
    let captured: { url: string; headers: Record<string, string>; body: Buffer } | null = null;
    await page.route("**/ajustes/bot", async (route) => {
      const request = route.request();
      if (request.method() !== "POST" || !(await request.headerValue("next-action")))
        return route.continue();
      captured = {
        url: request.url(),
        headers: await request.allHeaders(),
        body: request.postDataBuffer() ?? Buffer.alloc(0),
      };
      return route.abort();
    });
    await openPage(page, "/ajustes/bot");
    await page.getByLabel("Ambiente").selectOption({ label: "Casa" });
    await page.getByRole("button", { name: "Salvar padrões" }).click();
    await expect.poll(() => captured !== null).toBe(true);
    await page.unroute("**/ajustes/bot");
    const { url, headers, body } = captured!;
    // O cookie vai pelo contexto; o resto do pedido segue idêntico
    const replay = (origin: string) => {
      const sent = Object.fromEntries(
        Object.entries(headers).filter(
          ([name]) => !/^(cookie|host|content-length|origin)$/i.test(name),
        ),
      );
      return page.request.fetch(url, {
        method: "POST",
        headers: { ...sent, origin },
        data: body,
      });
    };

    const forged = await replay(ATTACKER);
    expect(forged.ok(), "a Server Action aceitou um pedido de outra origem").toBe(false);
    expect(await saved()).toBe("0");

    // O mesmo pedido com a origem do app grava: prova que o teste reproduz o envio de verdade
    const genuine = await replay(new URL(url).origin);
    expect(genuine.status()).toBe(200);
    expect(await saved()).toBe("1");
  });
});

test.describe("cookie da sessão", () => {
  test.use({ storageState: NO_SESSION });

  test("HttpOnly, SameSite=Lax e caminho / (o JavaScript da página não lê a sessão)", async ({
    request,
  }, testInfo) => {
    const email = testEmail("cookie", testInfo.project.name);
    const password = "frase longa do teste do cookie";
    await createTestUser(request, { email, password, twoFactor: false });
    const response = await request.post("/api/auth/sign-in/email", {
      headers: apiHeaders(fakeIp()),
      data: { email, password },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const session = response
      .headersArray()
      .filter((h) => h.name.toLowerCase() === "set-cookie")
      .map((h) => h.value)
      .find((value) => /^(__Secure-)?fintrack\.session_token=/.test(value));
    expect(session, "o login não gravou o cookie da sessão").toBeDefined();
    const attributes = session!.split(";").map((part) => part.trim().toLowerCase());
    expect(attributes).toContain("httponly");
    expect(attributes).toContain("samesite=lax");
    expect(attributes).toContain("path=/");
    // Em HTTPS (produção) o cookie é Secure e ganha o prefixo __Secure-: conferido pelo teste
    // de unidade src/lib/auth/cookies.test.ts, porque aqui o app roda em http://localhost
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
