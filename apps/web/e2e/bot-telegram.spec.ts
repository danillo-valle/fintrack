// O Telegram como segundo canal do bot (M12.0b, ADR-019) de ponta a ponta, contra o Telegram DE
// MENTIRA (e2e/telegram-fake.ts): os testes fazem o papel da pessoa no Telegram e leem a conversa
// como ela ficaria no celular. Cada aparelho usa uma pessoa, um lar e uma conversa inventada.
//
//   1. vincular em um toque: o "Abrir no Telegram" com o código no link, o /start, a tela que muda
//      sozinha; propor e Confirmar: a MESMA mensagem vira "Lançado" e os botões somem; lança uma vez
//   2. o código digitado de reserva (vincular 123 456) e a mensagem com número de cartão, que sai
//      da conversa sem nada guardado
//   3. o webhook: segredo errado não grava nada (a mutação: sem a conferência, este teste falha);
//      quem não está vinculado recebe só a frase de uso particular no /start
import { expect } from "@playwright/test";
import { PASSWORD, personWithHome } from "./bot-person";
import {
  createHouseholdDirect,
  createTestUser,
  expectNoA11yViolations,
  openPage,
  sql,
  test,
  testEmail,
  todaySaoPaulo,
} from "./helpers";
import { conversation, fakeChat, sendToTelegram, TELEGRAM_FAKE, waitForBot } from "./telegram";

/**
 * Abre a tela do código do Telegram por Ajustes e devolve o link e o código. A tela é o modal ou,
 * quando a navegação do Next demora mais de 2,5 s (a 1ª compilação do modal no `pnpm dev` de uma
 * máquina ocupada), a página inteira: a rede de segurança do M12.0 (`OpenCode`). O que o teste
 * prova é o vínculo, nos dois casos; o modal em si é provado pelo teste do WhatsApp.
 */
async function openTelegramCode(page: import("@playwright/test").Page) {
  await openPage(page, "/ajustes/bot");
  await expect(page.getByTestId("canal-telegram")).toContainText("Não vinculado");
  await page.getByRole("button", { name: "Vincular no Telegram" }).click();
  await page.waitForURL(/\/ajustes\/bot\/vincular\?codigo=.+&canal=telegram/);
  await expect(page.getByRole("heading", { name: "Abra o FinTrack no Telegram" })).toBeVisible();
  const href = (await page.getByTestId("abrir-telegram").getAttribute("href")) ?? "";
  const typed = (await page.getByTestId("codigo-vinculo").textContent())!.trim();
  return { href, typed };
}

test("vincular em um toque, propor e Confirmar: a mensagem do botão vira Lançado, uma vez só", async ({
  page,
}, testInfo) => {
  test.slow(); // vínculo, três mensagens e a fila em segundo plano
  const chat = fakeChat(1, testInfo.project.name);
  const person = await personWithHome(page, "tg-fluxo", testInfo.project.name);

  // ── 1. Vincular: o link leva o código; o /start do Telegram vincula ──
  const { href } = await openTelegramCode(page);
  expect(href).toMatch(new RegExp(`^https://t\\.me/${TELEGRAM_FAKE.botUsername}\\?start=\\d{6}$`));
  await expectNoA11yViolations(page); // a tela do código do Telegram
  const code = new URL(href).searchParams.get("start")!;
  await sendToTelegram({ chat, text: `/start ${code}` });
  await expect(page.getByRole("heading", { name: "Pronto, Telegram vinculado" })).toBeVisible({
    timeout: 20_000,
  });
  await waitForBot(chat, /^Pronto, Lia\. Este Telegram agora lança no FinTrack/);
  // Do Telegram, só o HMAC: nem o id da conversa
  const [link] = await sql<{ chatHash: string }>(
    `SELECT l."chatHash" FROM bot_telegram_link l JOIN "user" u ON u.id = l."userId" WHERE u.email = $1`,
    [person.email],
  );
  expect(link?.chatHash).toMatch(/^[0-9a-f]{64}$/);
  expect(link?.chatHash).not.toContain(chat);

  // ── 2. Os padrões: Casa e o Visa (os mesmos dos dois canais) ──
  await openPage(page, "/ajustes/bot");
  await expect(page.getByTestId("telegram-vinculado")).toBeVisible();
  await page.getByLabel("Ambiente").selectOption({ label: "Casa" });
  await page.getByLabel("Crédito").selectOption({ label: "Visa da Casa" });
  await page.getByRole("button", { name: "Salvar padrões" }).click();
  await expect(page.getByText("Padrões salvos.")).toBeVisible();

  // ── 3. Propor: o título em negrito por entidade, os botões embaixo, nada nas somas ──
  await sendToTelegram({ chat, text: "gastei 42,90 no mercado" });
  const proposal = await waitForBot(chat, /^Lançar assim\?/);
  const today = todaySaoPaulo();
  expect(proposal.text).toBe(
    `Lançar assim?\nR$ 42,90 · Mercado\nHoje, ${today.slice(8, 10)}/${today.slice(5, 7)} · crédito, Visa da Casa\nAmbiente: Casa`,
  );
  expect(proposal.text).not.toContain("0002");
  expect(proposal.buttons.map((b) => b.text)).toEqual(["Confirmar", "Cancelar"]);
  const count = async () =>
    (
      await sql<{ n: string }>(
        `SELECT count(*)::text AS n FROM "transaction" WHERE "householdId" = $1 AND source = 'BOT'`,
        [person.householdId],
      )
    )[0]!.n;
  expect(await count()).toBe("0");

  // ── 4. Confirmar: a MESMA mensagem muda, os botões viram o Desfazer; nenhuma mensagem nova ──
  const botMessages = async () => (await conversation(chat)).filter((m) => m.from === "bot").length;
  const before = await botMessages();
  await sendToTelegram({
    chat,
    button: { data: proposal.buttons[0]!.callback_data, messageId: proposal.id },
  });
  await expect
    .poll(async () => (await conversation(chat)).find((m) => m.id === proposal.id)?.text)
    .toBe("Lançado: R$ 42,90, Mercado.");
  const edited = (await conversation(chat)).find((m) => m.id === proposal.id)!;
  expect(edited.edited).toBe(true);
  expect(edited.buttons.map((b) => b.text)).toEqual(["Desfazer"]);
  expect(await botMessages()).toBe(before);
  await expect.poll(count).toBe("1");

  // O mesmo toque de novo: nada lança outra vez
  await sendToTelegram({
    chat,
    button: { data: proposal.buttons[0]!.callback_data, messageId: proposal.id },
  });
  await expect
    .poll(async () => (await conversation(chat)).find((m) => m.id === proposal.id)?.text)
    .toMatch(/já foi decidida/);
  expect(await count()).toBe("1");
});

test("o código digitado de reserva e o número de cartão que sai da conversa", async ({
  page,
}, testInfo) => {
  test.slow();
  const chat = fakeChat(2, testInfo.project.name);
  const person = await personWithHome(page, "tg-reserva", testInfo.project.name);

  // "Não abriu?": o código digitado também vincula
  const { typed } = await openTelegramCode(page);
  expect(typed).toMatch(/^vincular \d{3} \d{3}$/);
  await sendToTelegram({ chat, text: typed });
  await expect(page.getByRole("heading", { name: "Pronto, Telegram vinculado" })).toBeVisible({
    timeout: 20_000,
  });

  // O número montado na hora (nenhum arquivo do repositório tem 13 a 19 dígitos seguidos)
  const digits = ["4111", "1111", "1111", "1111"].join(" ");
  await sendToTelegram({ chat, text: `${digits} compra online 99` });
  await waitForBot(chat, /^Isso parecia um número de cartão\. Apaguei a sua mensagem/);
  const mine = (await conversation(chat)).filter((m) => m.from === "pessoa");
  expect(mine.at(-1)?.deleted).toBe(true);
  const drafts = await sql<{ n: string }>(
    `SELECT count(*)::text AS n FROM bot_draft WHERE "householdId" = $1`,
    [person.householdId],
  );
  expect(drafts[0]!.n).toBe("0");
});

test("sem conta nem cartão: a tela avisa e o bot diz o que falta (M12.1)", async ({
  page,
}, testInfo) => {
  test.slow(); // vínculo, uma mensagem e a fila em segundo plano
  // O caso da produção de 24/10: a pessoa edita um ambiente, mas não tem conta nem cartão
  const chat = fakeChat(4, testInfo.project.name);
  const email = testEmail("tg-sem-conta", testInfo.project.name);
  await createTestUser(page.request, { email, password: PASSWORD, name: "Lia Bot" });
  await createHouseholdDirect({
    name: `Lar sem contas ${testInfo.project.name}`,
    people: [{ email, role: "OWNER" }],
  });

  await openPage(page, "/ajustes/bot");
  const note = page.getByTestId("padroes-sem-pagamento");
  await expect(note).toContainText("Ainda não há com o que pagar.");
  await expect(note.getByRole("link", { name: "Cadastrar em Contas" })).toHaveAttribute(
    "href",
    "/ajustes/contas",
  );
  // As listas vazias ficam desabilitadas e dizem por quê; o ambiente continua escolhível
  await expect(page.getByLabel("Débito e pix")).toBeDisabled();
  await expect(page.getByLabel("Crédito")).toBeDisabled();
  await expect(page.getByLabel("Crédito")).toHaveAccessibleDescription(/Nenhum cartão de crédito/);
  await expect(page.getByLabel("Ambiente")).toBeEnabled();
  await expectNoA11yViolations(page);

  const { href } = await openTelegramCode(page);
  await sendToTelegram({ chat, text: `/start ${new URL(href).searchParams.get("start")!}` });
  await waitForBot(chat, /^Pronto, Lia\./);
  await sendToTelegram({ chat, text: "gastei 10 no mercado" });
  const reply = await waitForBot(chat, /^Você ainda não tem conta nem cartão/);
  expect(reply.text).toBe(
    "Você ainda não tem conta nem cartão em que possa lançar. Cadastre o seu em Ajustes › Contas, ou peça a quem administra a conta da casa.",
  );
  expect(reply.buttons).toEqual([]);
});

test("webhook do Telegram: segredo errado não grava nada; quem não está vinculado recebe só a frase", async ({
  page,
}, testInfo) => {
  const chat = fakeChat(3, testInfo.project.name);
  const rowsOf = (update: number) =>
    sql<{ outcome: string | null; body: unknown; userId: string | null }>(
      `SELECT outcome, "bodyCiphertext" AS body, "userId" FROM bot_message WHERE wamid = $1`,
      [`tg:${update}`],
    );
  // Segredo errado: nada gravado (o webhook grava ANTES de responder; a mutação: sem a
  // conferência, a linha existiria e viria a frase)
  const refused = await sendToTelegram({ chat, text: "/start", badSecret: true });
  expect(await rowsOf(refused)).toEqual([]);
  // Segredo certo, conta que ninguém vinculou: só a frase de uso particular
  await sendToTelegram({ chat, text: "/start" });
  await waitForBot(chat, /^Este bot é de uso particular\./);
  expect((await conversation(chat)).filter((m) => m.from === "bot")).toHaveLength(1);
  // Mensagem comum de quem não está vinculado: uma linha sem texto e sem dono, nenhuma resposta
  const unknown = await sendToTelegram({ chat, text: "gastei 50 no posto" });
  expect(await rowsOf(unknown)).toEqual([{ outcome: "UNKNOWN_NUMBER", body: null, userId: null }]);

  // Sem o segredo no cabeçalho, a rota pública responde igual (200, "ok")
  const response = await page.request.post("/api/telegram/webhook", {
    data: { update_id: 1, message: { text: "oi" } },
  });
  expect(response.status()).toBe(200);
  expect(await response.text()).toBe("ok");
});
