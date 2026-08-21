import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AppTabBar } from "@/components/app-tab-bar";
import { PeopleTabs } from "@/components/reservations/people-tabs";
import { getDb } from "@/db";
import { getMyGroups } from "@/db/access/groups";
import { countActiveGuestReservations } from "@/db/access/guest-identities";
import { getMyReservations } from "@/db/access/my-reservations";
import { getAuth } from "@/lib/auth";
import { loginHrefWithNext } from "@/lib/next-param";
import { resolveGuestIdentity } from "@/lib/viewer";

/**
 * People (§6.7): groups and "My bookings".
 *
 * Bookings are read as the *session user* here — never as the guest cookie,
 * even when both are present. That pairing is what the merge prompt is for:
 * until it's accepted, the guest's bookings stay the guest's.
 */
export default async function PeoplePage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect(loginHrefWithNext("/people"));

  const db = getDb();
  const groups = await getMyGroups(db, session.user.id);
  const reservations = await getMyReservations(db, { userId: session.user.id });
  // Own-list guest bookings are excluded from the count — see `/u/[nickname]`.
  const guest = await resolveGuestIdentity(db);
  const mergeCount = guest
    ? await countActiveGuestReservations(db, guest.id, session.user.id)
    : 0;

  const t = await getTranslations("people");

  return (
    <main className="mx-auto flex min-h-dvh max-w-105 flex-col px-6 pt-14 pb-28 lg:max-w-5xl lg:px-8 lg:pt-8 lg:pb-12">
      <header className="border-b-2 border-ink pb-4 lg:pb-5">
        <h1 className="font-serif text-[24px] font-semibold tracking-[-0.01em] lg:text-[30px]">
          {t("title")}
        </h1>
      </header>

      <PeopleTabs
        groups={groups}
        reservations={reservations}
        mergeCount={mergeCount}
      />

      <AppTabBar />
    </main>
  );
}
