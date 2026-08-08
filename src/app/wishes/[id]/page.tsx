import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { WishDetail } from "@/components/wishes/wish-detail";
import { getDb } from "@/db";
import { getOwnerWish } from "@/db/access/owner";
import { getAuth } from "@/lib/auth";

/**
 * Own wish detail. `getOwnerWish` is owner-scoped, so someone else's id — and
 * a malformed one — both read as "not found": ids are never an existence
 * oracle for another person's list.
 */
export default async function WishPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session)
    redirect(`/login?next=${encodeURIComponent(`/wishes/${id}`)}`);

  const wish = await getOwnerWish(getDb(), session.user.id, id);
  if (!wish) return <WishNotFound />;

  return <WishDetail wish={wish} />;
}

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
