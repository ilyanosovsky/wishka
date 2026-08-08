import { eq, sql } from "drizzle-orm";

import type { Db } from "../index";
import { profiles, user } from "../schema";

/**
 * Who a public list belongs to, as a guest sees them (DESIGN_BRIEF §6.5:
 * «Шапка: аватар, имя»).
 *
 * The nickname is a URL segment, not a display name — the name and the avatar
 * live on Better Auth's `user` row, which `profiles` alone never carries. This
 * module is the one join between the two, so every public surface (`/u/<nick>`,
 * `/w/<id>`, the recently-viewed trail) names a person the same way.
 *
 * SURPRISE INVARIANT — two tables, four columns, no reservation join. Nothing
 * here can learn about bookings, and nothing derived from one may be added:
 * these reads feed pages the *owner* also opens (their own `/u/<nick>`).
 *
 * Only already-public fields are selected: no email, no `partnerId`, no sizes.
 */
export type PublicIdentity = {
  userId: string;
  /** Canonical stored nickname — the `/u/<nickname>` URL segment. */
  nickname: string;
  /**
   * Display name (§6.5) — what headers, banners and share cards show, or null
   * when this user has none. Normalized here rather than at the call sites:
   * Better Auth's email-OTP signup writes `name: ""` and «Пропустить» on
   * `/welcome` never fills it in, and `"" ?? fallback` is `""` — so an
   * un-normalized empty string slipped past every `??` guard and rendered as a
   * blank `<h1>`, a blank «Из списка: » and a `" · Wishka"` title. A single
   * `nullif(btrim(...))` at the boundary makes those fallbacks fire.
   */
  name: string | null;
  /** Avatar URL on our own storage, or null for the initial-tile fallback. */
  image: string | null;
};

const columns = {
  userId: profiles.userId,
  nickname: profiles.nickname,
  name: sql<string | null>`nullif(btrim(${user.name}), '')`,
  image: user.image,
};

/**
 * Resolves a public list URL (`/u/<nickname>`) to its owner's display identity.
 * Case-insensitive, backed by the same `lower(nickname)` unique index
 * `getProfileByNickname` matches on, so `/u/Ilya` and `/u/ilya` agree.
 */
export async function getPublicIdentityByNickname(
  db: Db,
  nickname: string,
): Promise<PublicIdentity | null> {
  const rows = await db
    .select(columns)
    .from(profiles)
    .innerJoin(user, eq(user.id, profiles.userId))
    .where(sql`lower(${profiles.nickname}) = lower(${nickname})`)
    .limit(1);
  return rows[0] ?? null;
}

/**
 * The same identity keyed by user id — for `/w/<id>`, where the wish already
 * names its owner. Null when that user never finished onboarding (no profile
 * row, so no public list to name them by either).
 */
export async function getPublicIdentityByUserId(
  db: Db,
  userId: string,
): Promise<PublicIdentity | null> {
  const rows = await db
    .select(columns)
    .from(profiles)
    .innerJoin(user, eq(user.id, profiles.userId))
    .where(eq(profiles.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}
