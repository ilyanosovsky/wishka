import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { MyList } from "@/components/wishes/my-list";
import { getDb } from "@/db";
import { getOwnerWishes } from "@/db/access/owner";
import { getProfile } from "@/db/access/profiles";
import { getAuth } from "@/lib/auth";

/**
 * My List — the owner's home (DESIGN_BRIEF §6.2, Directions 3a/3b).
 *
 * Lives in the `(list)` route group purely so `loading.tsx` next to it stays
 * this screen's skeleton: a route group is invisible in the URL, so this is
 * still `/`, but the list-shaped fallback no longer covers sibling routes.
 *
 * Reads through `getOwnerWishes`, the query builder that cannot select
 * reservation columns, so nothing on this route can leak who reserved what.
 * The archive (`status: "gifted"`) is a separate screen and is deliberately
 * not counted here.
 */
export default async function Home() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const db = getDb();
  const profile = await getProfile(db, session.user.id);
  // Signed in but no profile means onboarding was abandoned — finish it first.
  if (!profile) redirect("/welcome");

  const wishes = await getOwnerWishes(db, session.user.id);

  return <MyList wishes={wishes} nickname={profile.nickname} />;
}
