"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import {
  isNicknameAvailable,
  NicknameTakenError,
  upsertProfile,
} from "@/db/access/profiles";
import { getAuth } from "@/lib/auth";
import { isCurrencyCode } from "@/lib/currencies";
import { sanitizeNextPath } from "@/lib/next-param";
import { NICKNAME_RE, sanitizeNickname } from "@/lib/nickname";

const NAME_MAX_LENGTH = 80;

async function requireSession() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return session;
}

export type NicknameCheck = "free" | "taken" | "invalid";

export async function checkNickname(nickname: string): Promise<NicknameCheck> {
  const session = await requireSession();
  if (!NICKNAME_RE.test(nickname)) return "invalid";
  const available = await isNicknameAvailable(
    getDb(),
    nickname,
    session.user.id,
  );
  return available ? "free" : "taken";
}

export async function completeOnboarding(
  input: {
    name: string;
    nickname: string;
    baseCurrency: string;
  },
  next?: string,
): Promise<{ error: "nickname" | "currency" } | never> {
  const session = await requireSession();

  const nickname = input.nickname.trim().toLowerCase();
  if (!NICKNAME_RE.test(nickname)) return { error: "nickname" };
  if (!isCurrencyCode(input.baseCurrency)) return { error: "currency" };

  const name = (input.name.trim() || session.user.name || nickname).slice(
    0,
    NAME_MAX_LENGTH,
  );
  // Avatar is intentionally absent here: user.image is written server-side by
  // the upload route only — the client never chooses the stored URL.
  try {
    await upsertProfile(getDb(), {
      userId: session.user.id,
      nickname,
      baseCurrency: input.baseCurrency,
    });
  } catch (error) {
    // Check-then-write race on the nickname unique index.
    if (error instanceof NicknameTakenError) return { error: "nickname" };
    throw error;
  }
  await getAuth().api.updateUser({ body: { name }, headers: await headers() });
  // Client-supplied, so re-sanitized here: an open redirect hides in a prop.
  redirect(sanitizeNextPath(next));
}

/** "Всё пропускаемо": generate a unique, non-identifying nickname and move on. */
export async function skipOnboarding(next?: string): Promise<void> {
  const session = await requireSession();
  const db = getDb();

  // Never derive from email here: the skip path publishes /u/<nickname>
  // without the user ever seeing it — email local parts must not leak.
  const rawName = session.user.name?.trim();
  const base = rawName ? sanitizeNickname(rawName) : randomNickname();

  let nickname = base.slice(0, 30);
  for (
    let i = 2;
    i <= 20 && !(await isNicknameAvailable(db, nickname, session.user.id));
    i++
  ) {
    const suffix = `-${i}`;
    nickname = `${base.slice(0, 30 - suffix.length)}${suffix}`;
  }

  try {
    await upsertProfile(db, {
      userId: session.user.id,
      nickname,
      baseCurrency: "USD",
    });
  } catch (error) {
    if (!(error instanceof NicknameTakenError)) throw error;
    await upsertProfile(db, {
      userId: session.user.id,
      nickname: randomNickname(),
      baseCurrency: "USD",
    });
  }
  redirect(sanitizeNextPath(next));
}

function randomNickname(): string {
  return `wisher-${crypto.randomUUID().slice(0, 8)}`;
}
