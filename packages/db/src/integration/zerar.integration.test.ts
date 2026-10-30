// O deploy/sql/zerar.sql (M12.4, ADR-024) num banco TEMPORÁRIO, nunca no do desenvolvimento: o
// teste cria um banco, aplica as migrações, grava o seed (24 meses da casa fictícia), roda o
// arquivo pelo psql, como o fintrack-zerar faz na produção, e confere o que ficou.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PACKAGE = path.resolve(import.meta.dirname, "../..");
const ZERAR_SQL = path.resolve(PACKAGE, "../../deploy/sql/zerar.sql");
const KEEP = ["_prisma_migrations", "user", "account", "twoFactor", "passkey", "session", "jwks"];

const admin = process.env.DATABASE_URL ?? "";
const name = `fintrack_zerar_${randomUUID().slice(0, 8)}`;
const url = (() => {
  const u = new URL(admin);
  u.pathname = `/${name}`;
  return u.toString();
})();

async function withClient<T>(connectionString: string, fn: (c: pg.Client) => Promise<T>) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Quantas linhas tem cada tabela do schema public. */
async function counts(): Promise<Record<string, number>> {
  return withClient(url, async (c) => {
    const { rows } = await c.query<{ t: string }>(
      "SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY 1",
    );
    const out: Record<string, number> = {};
    for (const { t } of rows) {
      // count(*)::int: uma contagem de linhas, que cabe num número do JavaScript
      const r = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM public."${t}"`);
      out[t] = r.rows[0]?.n ?? 0;
    }
    return out;
  });
}

function runZerar() {
  execFileSync("psql", [url, "-q", "-X", "-f", ZERAR_SQL], { stdio: "pipe" });
}

const env = { ...process.env, DATABASE_URL: url };

describe("zerar.sql: apaga os dados do app e mantém os logins", () => {
  let before: Record<string, number> = {};

  beforeAll(async () => {
    await withClient(admin, (c) => c.query(`CREATE DATABASE "${name}"`));
    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: PACKAGE,
      env,
      stdio: "pipe",
    });
    execFileSync("pnpm", ["exec", "prisma", "db", "seed"], { cwd: PACKAGE, env, stdio: "pipe" });
    await withClient(url, async (c) => {
      // Um login de verdade, como os que existem na produção: a pessoa, a senha, o 2FA e a sessão
      const userId = randomUUID();
      await c.query(
        `INSERT INTO "user" (id, name, email, "emailVerified", "twoFactorEnabled", "updatedAt")
         VALUES ($1, 'Pessoa de teste', 'zerar@fintrack.test', true, true, now())`,
        [userId],
      );
      await c.query(
        `INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
         VALUES ($1, $2, 'credential', $2, 'hash-de-teste', now(), now())`,
        [randomUUID(), userId],
      );
      await c.query(
        `INSERT INTO "twoFactor" (id, secret, "backupCodes", "userId") VALUES ($1, 's', 'b', $2)`,
        [randomUUID(), userId],
      );
      await c.query(
        `INSERT INTO session (id, "expiresAt", token, "createdAt", "updatedAt", "userId")
         VALUES ($1, now() + interval '1 day', $1, now(), now(), $2)`,
        [randomUUID(), userId],
      );
      await c.query(
        `INSERT INTO verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
         VALUES ($1, 'reset', 'x', now() + interval '1 hour', now(), now())`,
        [randomUUID()],
      );
      await c.query(
        `INSERT INTO audit_log (action, entity, "entityId", metadata)
         VALUES ('wallet.created', 'wallet', 'teste', '{}')`,
      );
      // A fila do pg-boss (o app a cria ao subir): um trabalho pendente e um horário fixo
      await c.query("CREATE SCHEMA pgboss");
      await c.query("CREATE TABLE pgboss.job (id int)");
      await c.query("CREATE TABLE pgboss.schedule (name text)");
      await c.query("INSERT INTO pgboss.job VALUES (1)");
      await c.query("INSERT INTO pgboss.schedule VALUES ('bot-daily')");
    });
    before = await counts();
  }, 180_000);

  afterAll(async () => {
    await withClient(admin, (c) => c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
  });

  it("antes, o banco tem os dados da casa fictícia e a auditoria", () => {
    expect(before.transaction).toBeGreaterThan(1000);
    expect(before.household).toBeGreaterThan(0);
    expect(before.audit_log).toBeGreaterThan(0);
    expect(before.verification).toBe(1);
  });

  it("depois, toda tabela fora dos logins está vazia, e os logins estão como antes", async () => {
    runZerar();
    const after = await counts();
    const notEmpty = Object.entries(after).filter(([t, n]) => !KEEP.includes(t) && n > 0);
    expect(notEmpty).toEqual([]);
    for (const t of KEEP) expect(after[t], t).toBe(before[t]);
    expect(after.user).toBeGreaterThanOrEqual(3); // as duas pessoas do seed e a de teste
    await withClient(url, async (c) => {
      expect((await c.query("SELECT count(*)::int AS n FROM pgboss.job")).rows[0].n).toBe(0);
      expect((await c.query("SELECT count(*)::int AS n FROM pgboss.schedule")).rows[0].n).toBe(1);
    });
  });

  it("a trava da auditoria volta logo depois: TRUNCATE sem a marca é recusado", async () => {
    await withClient(url, async (c) => {
      await expect(c.query("TRUNCATE audit_log")).rejects.toThrow(/tentativa de TRUNCATE/);
    });
  });

  it("rodar de novo num banco já zerado não dá erro (dá para repetir com segurança)", async () => {
    expect(() => runZerar()).not.toThrow();
  });
});
