import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins";
import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_COOKIE,
  type Locale,
} from "@/i18n/config";
import { getFromAddress, getResend } from "@/lib/email/client";
import { authCode, authCodeFooter, type AuthCodeType } from "@/lib/email/copy";
import { renderLedgerEmail } from "@/lib/email/template";

/**
 * Five wrong codes are evaluated before the identifier locks out; the sixth
 * submit answers TOO_MANY_ATTEMPTS. The login screen mirrors this number to
 * keep «осталось N попыток» truthful — see `src/app/login/login-form.tsx`.
 */
export const OTP_ALLOWED_ATTEMPTS = 5;

/**
 * The code email must arrive in the language of the login screen the user is
 * looking at. `sendVerificationOTP` runs inside that request, so next-intl's
 * request config resolves normally; the cookie read is a belt-and-braces
 * fallback for any future caller that is not request-scoped, because losing
 * the sign-in email over a locale lookup would be absurd.
 */
async function resolveEmailLocale(): Promise<Locale> {
  try {
    const locale = await getLocale();
    if (isLocale(locale)) return locale;
  } catch {
    // No next-intl request context — fall through to the raw cookie.
  }
  try {
    const cookieValue = (await cookies()).get(LOCALE_COOKIE)?.value;
    if (isLocale(cookieValue)) return cookieValue;
  } catch {
    // No request context at all.
  }
  return DEFAULT_LOCALE;
}

/** `Object.hasOwn`, not `in`: `"constructor" in authCode` is true, so `in`
 *  would hand back a prototype member and make `copy.subject[locale]` throw
 *  inside `sendVerificationOTP` — blocking the sign-in email entirely, which is
 *  the opposite of what this fallback exists for. */
function authCodeType(type: string): AuthCodeType {
  return Object.hasOwn(authCode, type) ? (type as AuthCodeType) : "sign-in";
}

/**
 * Subject + body for an OTP email, in the same Paper Ledger shell as every
 * other transactional email (src/lib/email/reservation-emails.ts). The code
 * sits alone on its own line so it is easy to read and to copy on a phone.
 * Pure — exported so the copy can be tested without booting Better Auth.
 */
export function buildOtpEmail(
  type: string,
  otp: string,
  locale: Locale,
): { subject: string; html: string; text: string } {
  const copy = authCode[authCodeType(type)];
  const { html, text } = renderLedgerEmail({
    locale,
    heading: copy.subject[locale],
    bodyLines: [copy.intro[locale], otp],
    footnote: authCodeFooter[locale],
  });
  return { subject: copy.subject[locale], html, text };
}

/** Misconfiguration must fail at boot, not at first login. */
function assertAuthEnv() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  if (process.env.NODE_ENV === "production" && !appUrl.startsWith("https://")) {
    // baseURL drives trustedOrigins AND the session cookie Secure flag.
    throw new Error("NEXT_PUBLIC_APP_URL must be https:// in production");
  }
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set");
  }
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");
}

function createAuth() {
  assertAuthEnv();

  return betterAuth({
    baseURL: process.env.NEXT_PUBLIC_APP_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    rateLimit: {
      // The default in-memory store is per-lambda on Vercel — useless.
      enabled: true,
      storage: "database",
      modelName: "rateLimit",
    },
    advanced: {
      ipAddress: {
        // Platform-set header first: client-supplied XFF chains are spoofable.
        ipAddressHeaders: ["x-vercel-forwarded-for", "x-forwarded-for"],
      },
    },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 60 * 15, // 15 min, matches the UI copy in DESIGN_BRIEF §6.1
        allowedAttempts: OTP_ALLOWED_ATTEMPTS,
        storeOTP: "hashed", // the code IS the credential — never store plaintext
        async sendVerificationOTP({ email, otp, type }) {
          const locale = await resolveEmailLocale();
          const { subject, html, text } = buildOtpEmail(type, otp, locale);
          const { error } = await getResend().emails.send({
            from: getFromAddress(),
            to: email,
            subject,
            html,
            text,
          });
          // Resend returns errors instead of throwing; surface them so the
          // failure reaches the logger instead of silently "succeeding".
          if (error)
            throw new Error(
              `Resend send failed: ${error.name}: ${error.message}`,
            );
        },
      }),
      // Must stay last: lets server actions set auth cookies.
      nextCookies(),
    ],
  });
}

type AuthInstance = ReturnType<typeof createAuth>;
let instance: AuthInstance | null = null;

/** Lazy singleton — keeps the module importable without env (e.g. next build in CI). */
export function getAuth(): AuthInstance {
  instance ??= createAuth();
  return instance;
}

export type Session = AuthInstance["$Infer"]["Session"];
