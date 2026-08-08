import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getProfile } from "@/db/access/profiles";
import { getAuth } from "@/lib/auth";
import { NewWishForm } from "./new-wish-form";

/** §6.3 step 3 — the shared step-3 form, reached three ways: "Заполнить
 *  вручную" straight from the FAB sheet (no params), the manual fallback
 *  after a failed/stoplist/quota parse (`?url=`, link preserved), or a
 *  successful/partial parse (`?parsed=1`, fields handed off via
 *  sessionStorage — see `new-wish-form.tsx`). */
export default async function NewWishPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string; parsed?: string }>;
}) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const profile = await getProfile(getDb(), session.user.id);
  const params = await searchParams;

  return (
    <main className="mx-auto min-h-dvh max-w-105 px-6 pt-8 pb-10">
      <NewWishForm
        baseCurrency={profile?.baseCurrency ?? "USD"}
        userId={session.user.id}
        url={params.url}
        parsed={params.parsed === "1"}
      />
    </main>
  );
}
