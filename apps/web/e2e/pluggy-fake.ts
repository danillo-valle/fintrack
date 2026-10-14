// A Pluggy de mentira dos testes E2E (M09.1): responde como a API de verdade, com o banco
// sintético (bancos Aurora e Exemplo, finais 0001 a 0003) e as datas relativas a hoje. O
// playwright.config.ts sobe este servidor e aponta o app para ele (PLUGGY_API_URL). Só escuta em
// 127.0.0.1. Nenhum teste chama a Pluggy de verdade.
//
//   pnpm exec tsx e2e/pluggy-fake.ts        (porta 8787; PLUGGY_FAKE_PORT muda)
import { todayCivil } from "@fintrack/core";
import { createFakePluggy, servePluggyFake, syntheticBank } from "@fintrack/importers/testing";

const port = Number.parseInt(process.env.PLUGGY_FAKE_PORT ?? "8787", 10);
const fake = createFakePluggy(syntheticBank(todayCivil()), { pageSize: 50 });
// Sem "await" no topo: o app web é CommonJS, e o tsx compila este arquivo do mesmo jeito
void servePluggyFake(fake, port).then(() =>
  process.stdout.write(`Pluggy de mentira em http://127.0.0.1:${port}\n`),
);
