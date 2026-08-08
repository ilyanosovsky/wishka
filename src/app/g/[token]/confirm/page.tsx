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
export default async function GuestSwitchPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { token } = await params;
  const next = sanitizeNextPath((await searchParams).next);

  const guest = await findGuestByToken(getDb(), token);
  if (!guest) redirect(next);

  return <SwitchPrompt token={token} next={next} />;
}
