// Quem está na sessão (M13.1, pranchas L-Sessao e L-CelSessao): as iniciais à vista em toda tela
// do app (pé do menu lateral no computador, canto de cima no celular), e um toque mostra o nome, o
// e-mail, os atalhos e o Sair. Antes, só dava para saber quem estava logado entrando em Ajustes.
import { expect } from "@playwright/test";
import {
  createHouseholdDirect,
  deleteHouseholds,
  expectNoA11yViolations,
  openPage,
  personInNewTab,
  test,
  testEmail,
} from "./helpers";

const created: string[] = [];
test.afterEach(async () => {
  await deleteHouseholds(created.splice(0));
});

test("as iniciais, o nome, o lar e o Sair", async ({ browser }, testInfo) => {
  const mobile = testInfo.project.name === "celular";
  const email = testEmail("sessao", testInfo.project.name);
  const person = await personInNewTab(browser, email, "Nelci Valle", {
    ...(mobile ? { viewport: { width: 412, height: 915 }, isMobile: true } : {}),
  });
  const { householdId } = await createHouseholdDirect({
    name: "Lar Valle",
    people: [{ email, role: "OWNER" }],
  });
  created.push(householdId);
  const page = person.page;

  await openPage(page, "/");
  const trigger = page.getByRole("button", { name: "Sua conta: Nelci Valle" }).filter({
    visible: true,
  });
  await expect(trigger).toHaveCount(1);
  await expect(trigger).toContainText("NV");
  await trigger.click();

  // O painel: o nome, o e-mail com o lar, os atalhos e o Sair
  const panel = mobile
    ? page.getByRole("dialog", { name: "Sua conta" })
    : page.getByRole("group", { name: "Sua conta" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Nelci Valle");
  await expect(panel).toContainText(`${email} · Lar Valle`);
  await expect(panel.getByRole("link", { name: "Senha, 2FA e sessões" })).toBeVisible();
  await expectNoA11yViolations(page);

  // Esc fecha
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();

  // Sair apaga a sessão e volta para a entrada; a tela do app pede login de novo
  await trigger.click();
  await panel.getByRole("button", { name: "Sair" }).click();
  await page.waitForURL(/\/entrar/);
  await openPage(page, "/ajustes");
  await expect(page).toHaveURL(/\/entrar\?next=%2Fajustes/);
  await person.close();
});
