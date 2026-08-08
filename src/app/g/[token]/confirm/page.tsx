import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { findGuestByToken } from "@/db/access/guest-identities";
import { sanitizeNextPath } from "@/lib/next-param";
import { SwitchPrompt } from "./switch-prompt";

/**
 * Device-switch confirmation for a manage-booking link (see `/g/[token]`).
 * Reached only when this device already holds a different guest identity. A
 * bad token just forwards to `next` — no error, no token-existence oracle.
 */

/**
 * The `[token]` segment of this URL *is* the guest's bearer credential
 * (`src/app/g/[token]/route.ts`), so belt-and-suspenders alongside the
 * `/g/` disallow in `src/app/robots.ts`: crawlers that ignore robots.txt for
 * pages linked from elsewhere would otherwise publish the token in a search
 * result, and anyone opening it adopts that guest's reservations.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};
export default async function GuestSwitchPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { token } = await params;
  const next = sanitizeNextPath((await searchParams).next);

  const guest = await findGuestByToken(getDb(), token);
  if (!guest) redirect(next);

  return <SwitchPrompt token={token} next={next} />;
}
