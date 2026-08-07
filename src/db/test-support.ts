import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import type { Db } from "./index";
import * as schema from "./schema";

/**
 * In-memory Postgres for tests. Runs the real generated migrations from
 * `drizzle/`, so the tests exercise the SQL that ships, not a re-derived schema.
 */

const MIGRATIONS_DIR = path.resolve(process.cwd(), "drizzle");

type Journal = { entries: { idx: number; tag: string }[] };

export async function readMigrationStatements(): Promise<string[]> {
  const journal = JSON.parse(
    await readFile(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
  ) as Journal;

  const statements: string[] = [];
  for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
    const sql = await readFile(
      path.join(MIGRATIONS_DIR, `${entry.tag}.sql`),
      "utf8",
    );
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) statements.push(trimmed);
    }
  }
  return statements;
}

export type TestDb = { db: Db; client: PGlite; close: () => Promise<void> };

export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  await client.waitReady;
  for (const statement of await readMigrationStatements()) {
    await client.exec(statement);
  }
  return {
    db: drizzle(client, { schema }),
    client,
    close: () => client.close(),
  };
}

let seq = 0;

/** Minimal Better Auth user row — enough to hang wishes and profiles off. */
export async function createUser(
  db: Db,
  overrides: Partial<typeof schema.user.$inferInsert> = {},
): Promise<string> {
  seq += 1;
  const id = overrides.id ?? `user-${seq}`;
  await db.insert(schema.user).values({
    id,
    name: overrides.name ?? `User ${seq}`,
    email: overrides.email ?? `user-${seq}@example.test`,
    emailVerified: true,
    ...overrides,
  });
  return id;
}

export async function createWish(
  db: Db,
  values: typeof schema.wishes.$inferInsert,
): Promise<string> {
  const [row] = await db
    .insert(schema.wishes)
    .values(values)
    .returning({ id: schema.wishes.id });
  return row.id;
}

export async function createGroup(
  db: Db,
  createdBy: string,
  members: string[],
): Promise<string> {
  seq += 1;
  const [group] = await db
    .insert(schema.groups)
    .values({ name: `Group ${seq}`, createdBy })
    .returning({ id: schema.groups.id });
  await db
    .insert(schema.groupMembers)
    .values(members.map((userId) => ({ groupId: group.id, userId })));
  return group.id;
}

export async function createGuest(db: Db, token: string): Promise<string> {
  const [guest] = await db
    .insert(schema.guestIdentities)
    .values({ token, name: `Guest ${token}` })
    .returning({ id: schema.guestIdentities.id });
  return guest.id;
}
