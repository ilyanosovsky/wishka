import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { MyList } from "@/components/wishes/my-list";
import { getDb } from "@/db";
import { getOwnerWishes } from "@/db/access/owner";
import { getProfile } from "@/db/access/profiles";
import { isAiAvailable } from "@/lib/ai/client";
import { getAiQuotaRemaining } from "@/lib/ai/quota";
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

// The add-wish parse action (parseUrlAction) is invoked from AddWishSheet on
// this route; give it room past the default so the pipeline's own 22s budget,
// not the platform limit, is what bounds a slow parse.
export const maxDuration = 60;
export default async function Home() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const db = getDb();
  const profile = await getProfile(db, session.user.id);
  // Signed in but no profile means onboarding was abandoned — finish it first.
  if (!profile) redirect("/welcome");

  // AI availability is checked server-side, same as everything else on this
  // page — an unavailable key never reaches the client as a boolean to
  // branch on, only as `ai` being absent from `MyList`'s props.
  const aiAvailable = isAiAvailable();
  const [wishes, aiQuota] = await Promise.all([
    getOwnerWishes(db, session.user.id),
    aiAvailable ? getAiQuotaRemaining(db, session.user.id) : null,
  ]);

  return (
    <MyList
      wishes={wishes}
      nickname={profile.nickname}
      ai={aiQuota ?? undefined}
    />
  );
}
