import "server-only";

import { Resend } from "resend";

let instance: Resend | null = null;

/** Lazy singleton, mirrors src/lib/auth.ts — keeps the module importable without env. */
export function getResend(): Resend {
  instance ??= new Resend(process.env.RESEND_API_KEY);
  return instance;
}

export function getFromAddress(): string {
  return process.env.EMAIL_FROM ?? "Wishka <onboarding@resend.dev>";
}
