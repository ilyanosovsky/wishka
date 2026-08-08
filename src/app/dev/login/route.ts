import { randomBytes, randomUUID } from "node:crypto";
import { makeSignature } from "better-auth/crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { profiles, session as sessionTable, user } from "@/db/schema";

/**
 * DEV-ONLY sign-in shortcut for authenticated-flow verification.
 * Mirrors the /dev/ui NODE_ENV gate: returns 404 in any production build
 * (Vercel previews included), so it is inert everywhere but `npm run dev`.
 * It mints a real Better Auth session cookie for a fixed local test user —
 * never wire this to anything that ships enabled.
 */

const TEST_USER = {
  id: "dev-test-user",
  email: "dev@wishka.local",
  name: "Тест Клод",
  nickname: "dev-test",
} as const;

// Second fixed identity so the reservation/guest flows can be exercised as
// someone other than the primary dev user, e.g. "friend reserves owner's
// wish" — same idempotent insert pattern, no email verification flow needed.
const TEST_FRIEND = {
  id: "dev-test-friend",
  email: "friend@wishka.local",
  name: "Друг Тест",
  nickname: "dev-friend",
} as const;

const COOKIE_NAME = "better-auth.session_token";
const SESSION_TTL = 60 * 60 * 24 * 7;

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return new NextResponse("Not found", { status: 404 });
  }
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret)
    return new NextResponse("BETTER_AUTH_SECRET not set", { status: 500 });

  const asFriend = new URL(request.url).searchParams.get("as") === "friend";
  const testUser = asFriend ? TEST_FRIEND : TEST_USER;

  const db = getDb();
  const now = new Date();

  await db
    .insert(user)
    .values({
      id: testUser.id,
      email: testUser.email,
      name: testUser.name,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  await db
    .insert(profiles)
    .values({
      userId: testUser.id,
      nickname: testUser.nickname,
      baseCurrency: "GEL",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  const token = randomBytes(32).toString("base64url");
  await db.insert(sessionTable).values({
    id: randomUUID(),
    userId: testUser.id,
    token,
    expiresAt: new Date(Date.now() + SESSION_TTL * 1000),
    createdAt: now,
    updatedAt: now,
  });

  const signed = `${token}.${await makeSignature(token, secret)}`;
  const res = NextResponse.redirect(new URL("/", request.url));
  res.cookies.set(COOKIE_NAME, signed, {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // dev only, http://localhost
    path: "/",
    maxAge: SESSION_TTL,
  });
  return res;
}
