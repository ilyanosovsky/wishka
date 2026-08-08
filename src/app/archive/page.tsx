import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ArchiveList } from "@/components/wishes/archive-list";
import { getDb } from "@/db";
import { getOwnerWishes } from "@/db/access/owner";
import { getAuth } from "@/lib/auth";

/** §6.9 — entered from the "My list" header, not a tab-bar item. */
export default async function ArchivePage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/login?next=%2Farchive");

  const wishes = await getOwnerWishes(getDb(), session.user.id, {
    status: "gifted",
  });

  return <ArchiveList wishes={wishes} />;
}
