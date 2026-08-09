import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db";
import { getOwnerWish } from "@/db/access/owner";
import { getProfile } from "@/db/access/profiles";
import { getAudienceCandidates, getWishAudience } from "@/db/access/visibility";
import { isAiAvailable } from "@/lib/ai/client";
import { getAiQuotaRemaining } from "@/lib/ai/quota";
import { getAuth } from "@/lib/auth";
import { EditWishForm } from "./edit-wish-form";

export default async function EditWishPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session)
    redirect(`/login?next=${encodeURIComponent(`/wishes/${id}/edit`)}`);

  const wish = await getOwnerWish(getDb(), session.user.id, id);
  // A wish deleted in another tab is reachable here; §3.5 "никаких тупиков" —
  // same shape and CTA as the sibling detail route's not-found.
  if (!wish) return <WishNotFound />;

  // Both reads are owner-scoped and server-side — the form receives the
  // audience it may edit, never a query path into it. AI availability is
  // checked the same way: an unavailable key never reaches the client as a
  // boolean to branch on, only as `ai` being absent.
  const aiAvailable = isAiAvailable();
  const [audience, candidates, aiQuota, profile] = await Promise.all([
    getWishAudience(getDb(), session.user.id, id),
    getAudienceCandidates(getDb(), session.user.id),
    aiAvailable ? getAiQuotaRemaining(getDb(), session.user.id) : null,
    getProfile(getDb(), session.user.id),
  ]);

  return (
    <main className="mx-auto min-h-dvh max-w-105 px-6 pt-8 pb-10">
      <EditWishForm
        wish={wish}
        audience={audience ?? undefined}
        candidates={candidates}
        ai={aiQuota ?? undefined}
        baseCurrency={profile?.baseCurrency ?? "USD"}
      />
    </main>
  );
}

/** Mirrors `src/app/wishes/[id]/page.tsx` — one shape for "this wish is gone",
 *  always with a way back to the list. */
async function WishNotFound() {
  const t = await getTranslations();

  return (
    <main className="mx-auto flex min-h-dvh max-w-105 flex-col items-center justify-center gap-4 px-5 text-center">
      <p className="font-serif text-[19px] font-semibold">
        {t("detail.notFound")}
      </p>
      <Link
        href="/"
        className="inline-flex min-h-11 items-center justify-center border border-accent bg-accent px-4 text-[13px] font-medium text-paper hover:bg-accent-ink"
      >
        {t("tabs.list")}
      </Link>
    </main>
  );
}
