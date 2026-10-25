// Prepara as capturas do README (M12.2): a conta de teste das capturas, a casa fictícia do seed com
// essa conta dentro (membro do grupo e editora da Casa) e a sessão guardada para as capturas.
// Só dados sintéticos: o seed é a "Família Exemplo" (Lia e Caio), com 24 meses inventados.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { test as setup } from "@playwright/test";
import { createTestUser } from "../helpers";
import { CAPTURE_AUTH_FILE, CAPTURE_USER } from "./shared";

setup("conta das capturas na casa fictícia do seed", async ({ request }) => {
  setup.setTimeout(180_000);
  // A conta nova (com 2FA) faz login nesta mesma sessão de API; depois o seed a põe na Casa
  await createTestUser(request, { ...CAPTURE_USER, twoFactor: true });
  execFileSync("pnpm", ["--filter", "@fintrack/db", "db:seed"], {
    cwd: path.resolve(process.cwd(), "../.."),
    env: { ...process.env, SEED_VIEWER_EMAIL: CAPTURE_USER.email },
    stdio: "inherit",
  });
  await request.storageState({ path: CAPTURE_AUTH_FILE });
});
