// As capturas de tela do README (M12.2). Rodam só com "pnpm capturas" (playwright.capturas.config.ts).
import { mkdirSync } from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";
import { openPage } from "../helpers";
import { CAPTURE_DIR, SCREENS, type CaptureDevice } from "./shared";

for (const scheme of ["light", "dark"] as const) {
  test.describe(scheme === "light" ? "claro" : "escuro", () => {
    test.use({ colorScheme: scheme });

    for (const screen of SCREENS) {
      test(screen.name, async ({ page }, testInfo) => {
        const device = testInfo.project.name as CaptureDevice;
        test.skip(!screen.devices.includes(device), "esta tela não tem captura neste aparelho");
        await openPage(page, screen.path);
        // As fontes e os gráficos no lugar antes da foto
        await page.evaluate(() => document.fonts.ready);
        await page.mouse.move(0, 0);
        mkdirSync(CAPTURE_DIR, { recursive: true });
        const theme = scheme === "light" ? "claro" : "escuro";
        await page.screenshot({
          path: path.join(CAPTURE_DIR, `${screen.name}-${theme}-${device}.png`),
          animations: "disabled",
          caret: "hide",
        });
      });
    }
  });
}
