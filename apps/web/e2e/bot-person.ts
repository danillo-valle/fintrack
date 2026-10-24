// A pessoa do bot nos testes (M11; compartilhada com o Telegram no M12.0b): uma conta com 2FA, um
// lar com a pessoal e a Casa, um cartão de crédito ("Visa da Casa", final 0002) e a regra
// "mercado" → Mercado. Um lar por teste e por aparelho.
import type { Page } from "@playwright/test";
import { createFinanceDirect, createHouseholdDirect, createTestUser, testEmail } from "./helpers";

export const PASSWORD = "frase longa da pessoa do bot do whatsapp";

/** Uma pessoa com lar (pessoal + Casa), um cartão de crédito e a regra "mercado" → Mercado. */
export async function personWithHome(page: Page, slug: string, project: string) {
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
