import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins";
import { Resend } from "resend";
import { getDb } from "@/db";
import * as schema from "@/db/schema";

const OTP_SUBJECTS: Record<string, { subject: string; intro: string }> = {
  "sign-in": {
    subject: "Your Wishka sign-in code",
    intro: "Your sign-in code:",
  },
  "email-verification": {
    subject: "Confirm your email for Wishka",
    intro: "Your confirmation code:",
  },
  "forget-password": {
    subject: "Your Wishka recovery code",
    intro: "Your recovery code:",
  },
};

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
  const resend = new Resend(process.env.RESEND_API_KEY);

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
        allowedAttempts: 5,
        storeOTP: "hashed", // the code IS the credential — never store plaintext
        async sendVerificationOTP({ email, otp, type }) {
          const { subject, intro } =
            OTP_SUBJECTS[type] ?? OTP_SUBJECTS["sign-in"];
          const { error } = await resend.emails.send({
            from: process.env.EMAIL_FROM ?? "Wishka <onboarding@resend.dev>",
            to: email,
            subject,
            text: `${intro} ${otp}\n\nThe code expires in 15 minutes. If you didn't request it, just ignore this email.`,
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
