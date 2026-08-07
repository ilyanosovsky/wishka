// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTestDb,
  readMigrationStatements,
  type TestDb,
} from "./test-support";

describe("migrations", () => {
  let ctx: TestDb;

  beforeAll(async () => {
    ctx = await createTestDb();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("apply cleanly on a fresh database", async () => {
    const tables = await ctx.client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual([
      "account",
      "ai_usage",
      "group_invites",
      "group_members",
      "groups",
      "guest_identities",
      "parsed_url_cache",
      "profiles",
      "rate_limit",
      "reservations",
      "session",
      "user",
      "verification",
      "wish_visibility",
      "wishes",
    ]);
  });

  it("ship the partial unique index that guards one active reservation per wish", async () => {
    const statements = await readMigrationStatements();
    expect(
      statements.some(
        (s) =>
          s.includes(
            'CREATE UNIQUE INDEX "reservations_one_active_per_wish"',
          ) && s.includes("WHERE state = 'active'"),
      ),
    ).toBe(true);

    const indexes = await ctx.client.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where indexname = 'reservations_one_active_per_wish'",
    );
    expect(indexes.rows[0]?.indexdef).toContain("WHERE (state = 'active'");
  });

  it("ship the reserver check constraint", async () => {
    const constraints = await ctx.client.query<{ conname: string }>(
      "select conname from pg_constraint where contype = 'c' order by conname",
    );
    const names = constraints.rows.map((r) => r.conname);
    expect(names).toContain("reservations_reserver_check");
    expect(names).toContain("wishes_status_check");
  });

  it("allow the quota kinds and reservation states the app uses", async () => {
    const kinds = ["image", "text", "upload"];
    const userId = "check-user";
    await ctx.client.exec(
      `insert into "user" ("id", "name", "email") values ('${userId}', 'Check', 'check@example.test')`,
    );
    for (const kind of kinds) {
      await ctx.client.exec(
        `insert into "ai_usage" ("user_id", "day", "kind") values ('${userId}', '2026-08-07', '${kind}')`,
      );
    }
    await expect(
      ctx.client.exec(
        `insert into "ai_usage" ("user_id", "day", "kind") values ('${userId}', '2026-08-08', 'video')`,
      ),
    ).rejects.toThrow();

    const stateCheck = await ctx.client.query<{ definition: string }>(
      "select pg_get_constraintdef(oid) as definition from pg_constraint where conname = 'reservations_state_check'",
    );
    expect(stateCheck.rows[0]?.definition).toContain("'fulfilled'");
    expect(stateCheck.rows[0]?.definition).not.toContain("orphaned");
  });

  it("keep wishes free of any reservation column", async () => {
    const columns = await ctx.client.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'wishes'",
    );
    for (const { column_name } of columns.rows) {
      expect(column_name).not.toMatch(/reserv/i);
    }
  });
});
