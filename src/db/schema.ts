import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  WishImageStatus,
  WishPriceType,
  WishPriority,
  WishStatus,
  WishType,
  WishVisibility,
} from "./access/types";

/**
 * Wishka schema.
 *
 * Naming: DB objects are snake_case, TypeScript keys are camelCase. The Better
 * Auth Drizzle adapter looks columns up by their *TypeScript* key, so the four
 * auth tables must keep the camelCase keys Better Auth v1.6 generates by
 * default (`emailVerified`, `userId`, `expiresAt`, …).
 */

const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow();

/* ── Better Auth core tables ─────────────────────────────────────────────── */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt,
  updatedAt,
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt,
    updatedAt,
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt,
    updatedAt,
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt,
    updatedAt,
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/**
 * Better Auth's `rateLimit: { storage: "database" }` table. `last_request` is a
 * millisecond epoch (`Date.now()`), not a timestamp — that is what Better Auth
 * writes and compares.
 */
export const rateLimit = pgTable(
  "rate_limit",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    count: integer("count").notNull(),
    lastRequest: bigint("last_request", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("rate_limit_key_idx").on(t.key)],
);

/* ── Profiles ────────────────────────────────────────────────────────────── */

export const profiles = pgTable(
  "profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    nickname: text("nickname").notNull().unique(),
    baseCurrency: char("base_currency", { length: 3 }).notNull().default("USD"),
    partnerId: text("partner_id").references(() => user.id, {
      onDelete: "set null",
    }),
    sizes: jsonb("sizes")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    tastes: jsonb("tastes")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    noGift: jsonb("no_gift")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt,
    updatedAt,
  },
  // Nicknames are compared case-insensitively everywhere; enforce that in the DB.
  (t) => [
    uniqueIndex("profiles_nickname_lower_idx").on(sql`lower(${t.nickname})`),
  ],
);

/* ── Groups ──────────────────────────────────────────────────────────────── */

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  emoji: text("emoji"),
  color: text("color"),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt,
});

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").$type<"admin" | "member">().notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    check("group_members_role_check", sql`${t.role} in ('admin', 'member')`),
    index("group_members_user_id_idx").on(t.userId),
  ],
);

/** The invite id doubles as the invite token — it is never guessable (uuid v4). */
export const groupInvites = pgTable(
  "group_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [index("group_invites_group_id_idx").on(t.groupId)],
);

/* ── Wishes ──────────────────────────────────────────────────────────────── */

/**
 * Surprise invariant: this table carries no reservation state whatsoever.
 * Whether a wish is taken lives only in `reservations`, so an owner-facing
 * query over `wishes` cannot leak it even by accident.
 *
 * `gifted_by` is deliberately free text and never a foreign key — the owner
 * types who gave the gift after the fact; it must never be derivable from a
 * reserver identity.
 */
export const wishes = pgTable(
  "wishes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").$type<WishType>().notNull().default("product"),
    title: text("title").notNull(),
    url: text("url"),
    imageKey: text("image_key"),
    imageStatus: text("image_status")
      .$type<WishImageStatus>()
      .notNull()
      .default("none"),
    description: text("description"),
    priceType: text("price_type")
      .$type<WishPriceType>()
      .notNull()
      .default("none"),
    priceMin: numeric("price_min", { precision: 12, scale: 2 }),
    priceMax: numeric("price_max", { precision: 12, scale: 2 }),
    currency: char("currency", { length: 3 }),
    priority: text("priority").$type<WishPriority>().notNull().default("nice"),
    isDream: boolean("is_dream").notNull().default(false),
    category: text("category"),
    notes: text("notes"),
    visibility: text("visibility")
      .$type<WishVisibility>()
      .notNull()
      .default("everyone"),
    status: text("status").$type<WishStatus>().notNull().default("active"),
    giftedAt: timestamp("gifted_at", { withTimezone: true }),
    giftedBy: text("gifted_by"),
    createdAt,
    updatedAt,
  },
  (t) => [
    check(
      "wishes_type_check",
      sql`${t.type} in ('product', 'experience', 'service', 'certificate')`,
    ),
    check(
      "wishes_image_status_check",
      sql`${t.imageStatus} in ('none', 'ready', 'generating', 'failed')`,
    ),
    check(
      "wishes_price_type_check",
      sql`${t.priceType} in ('none', 'exact', 'range')`,
    ),
    check(
      "wishes_priority_check",
      sql`${t.priority} in ('want', 'nice', 'idea')`,
    ),
    check(
      "wishes_visibility_check",
      sql`${t.visibility} in ('everyone', 'restricted')`,
    ),
    check("wishes_status_check", sql`${t.status} in ('active', 'gifted')`),
    index("wishes_owner_id_idx").on(t.ownerId),
  ],
);

/** Who a `visibility = 'restricted'` wish is shown to: groups and/or people. */
export const wishVisibility = pgTable(
  "wish_visibility",
  {
    wishId: uuid("wish_id")
      .notNull()
      .references(() => wishes.id, { onDelete: "cascade" }),
    // 'group' → a groups.id; 'user' → a user.id. Text, because the two id types
    // differ (uuid vs text), so no foreign key is possible here.
    subjectType: text("subject_type").$type<"group" | "user">().notNull(),
    subjectId: text("subject_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.wishId, t.subjectType, t.subjectId] }),
    check(
      "wish_visibility_subject_type_check",
      sql`${t.subjectType} in ('group', 'user')`,
    ),
  ],
);

/* ── Reservations ────────────────────────────────────────────────────────── */

/** A friend who reserved without signing up: identified by a device token. */
export const guestIdentities = pgTable("guest_identities", {
  id: uuid("id").primaryKey().defaultRandom(),
  token: text("token").notNull().unique(),
  name: text("name").notNull(),
  email: text("email"),
  createdAt,
});

export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    wishId: uuid("wish_id")
      .notNull()
      .references(() => wishes.id, { onDelete: "cascade" }),
    reserverUserId: text("reserver_user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    guestId: uuid("guest_id").references(() => guestIdentities.id, {
      onDelete: "cascade",
    }),
    state: text("state")
      .$type<"active" | "cancelled" | "fulfilled">()
      .notNull()
      .default("active"),
    createdAt,
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "reservations_state_check",
      sql`${t.state} in ('active', 'cancelled', 'fulfilled')`,
    ),
    // Exactly one reserver identity: a signed-in user or a guest, never both.
    check(
      "reservations_reserver_check",
      sql`(${t.reserverUserId} is not null)::int + (${t.guestId} is not null)::int = 1`,
    ),
    // At most one *active* reservation per wish — the race guard behind
    // `reserveWish`'s "already_reserved" result.
    uniqueIndex("reservations_one_active_per_wish")
      .on(t.wishId)
      .where(sql`state = 'active'`),
    index("reservations_wish_id_idx").on(t.wishId),
  ],
);

/* ── Infrastructure tables ───────────────────────────────────────────────── */

/** One parse per URL globally; `url_hash` is a sha-256 of the normalized URL. */
export const parsedUrlCache = pgTable("parsed_url_cache", {
  urlHash: text("url_hash").primaryKey(),
  url: text("url").notNull(),
  data: jsonb("data").notNull(),
  createdAt,
});

/** Per-user, per-day AI quota counters. `day` is a calendar date in UTC. */
export const aiUsage = pgTable(
  "ai_usage",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    kind: text("kind").$type<"image" | "text" | "upload">().notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.day, t.kind] }),
    check("ai_usage_kind_check", sql`${t.kind} in ('image', 'text', 'upload')`),
  ],
);
