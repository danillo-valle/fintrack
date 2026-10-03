// A trilha de auditoria só aceita INSERT: o gatilho da migração recusa UPDATE, DELETE e TRUNCATE.
// Cada teste roda dentro de BEGIN ... ROLLBACK, com SAVEPOINT antes de cada tentativa: assim
// nenhuma linha de teste fica para sempre na tabela (que, afinal, não deixa apagar).
import { describe, expect, it } from "vitest";
import { withPgClient } from "./fixtures";

async function insertEvent(client: import("pg").Client): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO audit_log (action, entity, "entityId", metadata)
     VALUES ('wallet.created', 'wallet', 'teste', '{"origem":"teste de integração"}')
     RETURNING id`,
  );
  return rows[0]?.id ?? "";
}

/** Roda o comando num savepoint e devolve a mensagem de erro do banco (ou "passou"). */
async function attempt(client: import("pg").Client, sql: string, values: unknown[] = []) {
  await client.query("SAVEPOINT tentativa");
  try {
    await client.query(sql, values);
    return "passou";
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT tentativa");
    return error instanceof Error ? error.message : String(error);
  }
}

describe("audit_log: só acrescenta", () => {
  it("INSERT funciona", async () => {
    await withPgClient(async (client) => {
      await client.query("BEGIN");
      const id = await insertEvent(client);
      expect(id).toMatch(/^\d+$/);
      await client.query("ROLLBACK");
    });
  });

  it("UPDATE, DELETE e TRUNCATE são recusados pelo gatilho", async () => {
    await withPgClient(async (client) => {
      await client.query("BEGIN");
      const id = await insertEvent(client);
      expect(
        await attempt(client, `UPDATE audit_log SET action = 'x' WHERE id = $1`, [id]),
      ).toMatch(/só aceita INSERT \(tentativa de UPDATE\)/);
      expect(await attempt(client, `DELETE FROM audit_log WHERE id = $1`, [id])).toMatch(
        /só aceita INSERT \(tentativa de DELETE\)/,
      );
      expect(await attempt(client, `TRUNCATE audit_log`)).toMatch(
        /só aceita INSERT \(tentativa de TRUNCATE\)/,
      );
      await client.query("ROLLBACK");
    });
  });
});
