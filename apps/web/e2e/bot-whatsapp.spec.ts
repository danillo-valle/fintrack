// O bot do WhatsApp (M11) de ponta a ponta, contra a Cloud API DE MENTIRA (e2e/whatsapp-fake.ts):
// os testes fazem o papel da pessoa no WhatsApp e leem as respostas que o app mandou. Cada
// aparelho usa uma pessoa, um lar e um número inventado próprios.
//
//   1. vincular: o código na web (modal), a mensagem "vincular …" e a tela que muda sozinha
//   2. lançar: a proposta com os botões, nada nas somas antes do Confirmar, a proposta em
//      Recebidos, a reentrega da mesma mensagem (não duplica), o Confirmar (lança uma vez só)
//   3. o webhook: assinatura errada não grava nada (a mutação: sem a conferência, este teste
//      falha), número desconhecido não gera proposta, a verificação do painel da Meta
//   4. a tela de Ajustes a 320 px, o interruptor e o axe
import { expect } from "@playwright/test";
import {
  createFinanceDirect,
  createHouseholdDirect,
  createTestUser,
  expectNoA11yViolations,
  openPage,
  sql,
  test,
  testEmail,
  todaySaoPaulo,
} from "./helpers";
import {
  fakePhone,
  replyButtons,
  replyText,
  sendToBot,
  waitForReply,
  WHATSAPP_FAKE,
} from "./whatsapp";

const PASSWORD = "frase longa da pessoa do bot do whatsapp";

/** Uma pessoa com lar (pessoal + Casa), um cartão de crédito e a regra "mercado" → Mercado. */
async function personWithHome(
  page: import("@playwright/test").Page,
  slug: string,
  project: string,
) {
  const email = testEmail(slug, project);
  await createTestUser(page.request, {
    email,
    password: PASSWORD,
    name: "Lia Bot",
    twoFactor: true,
  });
  const { householdId, personal, shared } = await createHouseholdDirect({
    name: `Lar do bot ${project}`,
    people: [{ email, role: "OWNER" }],
    shared: [{ name: "Casa", members: [{ email, role: "OWNER" }] }],
  });
  const { cards } = await createFinanceDirect({
    householdId,
    accounts: [
      {
        walletId: personal[email]!,
        name: "Cartão Aurora",
        kind: "CREDIT_CARD",
        holderEmail: email,
        closingDay: 27,
        dueDay: 5,
        cards: [{ nickname: "Visa da Casa", lastFour: "0002", holderEmail: email }],
      },
    ],
    categories: [{ name: "Mercado", kind: "EXPENSE" }],
    rules: [{ pattern: "mercado", category: "Mercado" }],
  });
  return {
    email,
    householdId,
    personalId: personal[email]!,
    homeId: shared.Casa!,
    cardId: cards["Visa da Casa"]!,
  };
}

test("vincular o número, propor, não duplicar e confirmar uma vez só", async ({
  page,
}, testInfo) => {
  test.slow(); // vínculo, quatro mensagens e a fila em segundo plano
  const phone = fakePhone(1, testInfo.project.name);
  const person = await personWithHome(page, "bot-fluxo", testInfo.project.name);

  // ── 1. Vincular ──
  await openPage(page, "/ajustes/bot");
  await expect(page.getByTestId("cartao-numero")).toContainText("Nenhum número vinculado");
  await page.getByRole("button", { name: "Vincular meu número" }).click();
  await page.waitForURL(/\/ajustes\/bot\/vincular\?codigo=/);
  const dialog = page.getByRole("dialog", { name: "Mande o código pelo WhatsApp" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("vinculo-esperando")).toContainText(WHATSAPP_FAKE.displayNumber);
  await expectNoA11yViolations(page); // o modal com o código
  const code = (await dialog.getByTestId("codigo-vinculo").textContent())!.trim();
  expect(code).toMatch(/^vincular \d{3} \d{3}$/);
  await sendToBot({ from: phone, text: code });
  // A tela muda sozinha (sem recarregar) quando a mensagem chega
  await expect(page.getByRole("dialog", { name: "Pronto, número vinculado" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("vinculo-pronto")).toContainText(`final ${phone.slice(-4)}`);
  await waitForReply(phone, /^Pronto, Lia\. Seu número está vinculado\./);
  // O número inteiro não está em lugar nenhum do banco: só o HMAC e os 4 dígitos
  const [link] = await sql<{ phoneHash: string; phoneLastFour: string }>(
    `SELECT l."phoneHash", l."phoneLastFour" FROM bot_link l JOIN "user" u ON u.id = l."userId" WHERE u.email = $1`,
    [person.email],
  );
  expect(link?.phoneLastFour).toBe(phone.slice(-4));
  expect(link?.phoneHash).not.toContain(phone);

  // ── 2. Os padrões: Casa e o Visa ──
  await openPage(page, "/ajustes/bot");
  await expect(page.getByTestId("numero-vinculado")).toContainText(phone.slice(-4));
  await page.getByLabel("Ambiente").selectOption({ label: "Casa" });
  await page.getByLabel("Crédito").selectOption({ label: "Visa da Casa" });
  await page.getByRole("button", { name: "Salvar padrões" }).click();
  await expect(page.getByText("Padrões salvos.")).toBeVisible();

  // ── 3. Propor: a mensagem vira proposta, nada nas somas ──
  const wamid = await sendToBot({ from: phone, text: "gastei 42,90 no mercado" });
  const today = todaySaoPaulo();
  const proposal = await waitForReply(phone, /^\*Lançar assim\?\*/);
  expect(replyText(proposal)).toBe(
    `*Lançar assim?*\nR$ 42,90 · Mercado\nHoje, ${today.slice(8, 10)}/${today.slice(5, 7)} · crédito, Visa da Casa\nAmbiente: Casa`,
  );
  // Nunca o final do cartão na resposta (só o apelido)
  expect(replyText(proposal)).not.toContain("0002");
  const [confirm, cancel] = replyButtons(proposal);
  expect([confirm?.title, cancel?.title]).toEqual(["Confirmar", "Cancelar"]);
  const count = async () =>
    (
      await sql<{ n: string }>(
        `SELECT count(*)::text AS n FROM "transaction" WHERE "householdId" = $1 AND source = 'BOT'`,
        [person.householdId],
      )
    )[0]!.n;
  expect(await count()).toBe("0");

  // A mesma mensagem entregue de novo pela Meta: nenhuma proposta a mais
  await sendToBot({ from: phone, text: "gastei 42,90 no mercado", wamid });
  const drafts = await sql<{ n: string }>(
    `SELECT count(*)::text AS n FROM bot_draft WHERE "householdId" = $1`,
    [person.householdId],
  );
  expect(drafts[0]!.n).toBe("1");

  // Em Recebidos, a proposta espera o Confirmar
  await openPage(page, "/lancamentos/recebidos");
  const section = page.getByTestId("do-whatsapp");
  await expect(section).toContainText("1 proposta esperando o seu Confirmar");
  await expect(section.getByTestId("proposta-whatsapp")).toContainText("Mercado");
  await expectNoA11yViolations(page);

  // ── 4. Confirmar pelo botão; o segundo clique não lança de novo ──
  await sendToBot({ from: phone, button: confirm!.id });
  await waitForReply(phone, /^Lançado: R\$ 42,90, Mercado\.$/);
  await expect.poll(count).toBe("1");
  await sendToBot({ from: phone, button: confirm!.id });
  await waitForReply(phone, /já foi decidida/);
  expect(await count()).toBe("1");
  const [row] = await sql<{ amount: string; walletId: string; cardId: string; status: string }>(
    `SELECT amount::text, "walletId", "cardId", status FROM "transaction" WHERE "householdId" = $1 AND source = 'BOT'`,
    [person.householdId],
  );
  expect(row).toEqual({
    amount: "-42.90",
    walletId: person.homeId,
    cardId: person.cardId,
    status: "CONFIRMED",
  });

  // A proposta saiu de Recebidos
  await openPage(page, "/lancamentos/recebidos");
  await expect(page.getByTestId("do-whatsapp")).toHaveCount(0);
});

test("código vencido: Gerar outro troca o código, Fechar volta para Ajustes e a senha vencida é pedida", async ({
  page,
}, testInfo) => {
  // M12.0: no Safari, gerar outro código de dentro da caixa deixava a tela parada. A causa no app:
  // o botão de dentro da caixa EMPILHAVA o endereço, e o Fechar (que volta uma página) caía no
  // código anterior, já vencido, em vez de Ajustes.
  const person = await personWithHome(page, "bot-vencido", testInfo.project.name);
  await openPage(page, "/ajustes/bot");
  await page.getByRole("button", { name: "Vincular meu número" }).click();
  await page.waitForURL(/\/ajustes\/bot\/vincular\?codigo=/);
  const first = new URL(page.url()).searchParams.get("codigo");
  // O código vence com a caixa aberta (a tela se atualiza sozinha a cada 3 s)
  await sql(
    `UPDATE bot_link_code c SET "createdAt" = now() - interval '20 minutes', "expiresAt" = now() - interval '10 minutes'
       FROM "user" u WHERE u.id = c."userId" AND u.email = $1`,
    [person.email],
  );
  const dialog = page.getByRole("dialog", { name: "Esse código não vale mais" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole("button", { name: "Gerar outro código" }).click();
  await expect(page.getByRole("dialog", { name: "Mande o código pelo WhatsApp" })).toBeVisible();
  const second = new URL(page.url()).searchParams.get("codigo");
  expect(second).not.toBe(first);
  // Fechar sai para Ajustes (antes: voltava para o código vencido)
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();
  await page.waitForURL(/\/ajustes\/bot$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Mais de 10 minutos desde a última senha: o botão leva a "Confirme que é você"
  await sql(
    `UPDATE "session" s SET "createdAt" = now() - interval '30 minutes' FROM "user" u
       WHERE u.id = s."userId" AND u.email = $1`,
    [person.email],
  );
  await page.getByRole("button", { name: "Vincular meu número" }).click();
  await page.waitForURL(/\/reautenticar\?next=%2Fajustes%2Fbot/);
});

test("webhook: assinatura errada não grava nada; número desconhecido não propõe", async ({
  request,
}, testInfo) => {
  const phone = fakePhone(2, testInfo.project.name);
  // Assinatura errada: a Meta recebe 200 (a resposta não ensina nada), e NADA é gravado.
  // Sem a conferência da assinatura, a mensagem seria gravada (como número desconhecido) e o
  // teste falharia: é a prova de que a conferência existe
  const forged = await sendToBot({ from: phone, text: "gastei 50 no posto", badSignature: true });
  expect(await sql("SELECT 1 FROM bot_message WHERE wamid = $1", [forged])).toHaveLength(0);

  // Assinatura certa, número que ninguém vinculou: uma linha sem texto e sem dono; nenhuma proposta
  const unknown = await sendToBot({ from: phone, text: "gastei 50 no posto" });
  await expect
    .poll(
      async () =>
        (
          await sql<{ outcome: string }>("SELECT outcome FROM bot_message WHERE wamid = $1", [
            unknown,
          ])
        )[0]?.outcome,
    )
    .toBe("UNKNOWN_NUMBER");
  const [message] = await sql<{ body: unknown; userId: string | null }>(
    `SELECT "bodyCiphertext" AS body, "userId" FROM bot_message WHERE wamid = $1`,
    [unknown],
  );
  expect(message).toEqual({ body: null, userId: null });

  // A verificação do painel da Meta: o token certo devolve o desafio; o errado, 403
  const ok = await request.get(
    `/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${WHATSAPP_FAKE.verifyToken}&hub.challenge=desafio123`,
  );
  expect(ok.status()).toBe(200);
  expect(await ok.text()).toBe("desafio123");
  const wrong = await request.get(
    "/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=outro-token-qualquer&hub.challenge=desafio123",
  );
  expect(wrong.status()).toBe(403);
});

test("Ajustes › Bot: o interruptor, a 320 px e o axe", async ({ page }, testInfo) => {
  await personWithHome(page, "bot-ajustes", testInfo.project.name);
  await openPage(page, "/ajustes/bot");
  await expect(page.getByTestId("bot-estado")).toHaveText("Ligado");
  await expect(page.getByTestId("cartao-conta")).toContainText("de 900");
  await expectNoA11yViolations(page);

  const toggle = page.getByTestId("bot-interruptor");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(page.getByTestId("bot-estado")).toHaveText("Desligado");
  await expect(page.getByTestId("bot-interruptor")).toHaveAttribute("aria-checked", "false");
  await page.getByTestId("bot-interruptor").click();
  await expect(page.getByTestId("bot-estado")).toHaveText("Ligado");

  // A tela mais estreita (320 px): nada vaza para os lados
  await page.setViewportSize({ width: 320, height: 800 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  for (const id of ["cartao-bot", "cartao-conta", "cartao-numero", "cartao-mensagens"]) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box && box.x + box.width, id).toBeLessThanOrEqual(320);
  }
});
