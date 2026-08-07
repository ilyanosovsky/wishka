import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getProfile } from "@/db/access/profiles";
import { getAuth } from "@/lib/auth";
import { NewWishForm } from "./new-wish-form";

/** §6.3 step 3 — "Заполнить вручную" entry point (parsing/AI arrive in
 *  Phases 5–6; this is the manual-only path, always available). */
export default async function NewWishPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const profile = await getProfile(getDb(), session.user.id);

  return (
    <main className="mx-auto min-h-dvh max-w-105 px-6 pt-8 pb-10">
      <NewWishForm
        baseCurrency={profile?.baseCurrency ?? "USD"}
        userId={session.user.id}
      />
    </main>
  );
}
