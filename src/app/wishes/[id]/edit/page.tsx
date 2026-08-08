import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db";
import { getOwnerWish } from "@/db/access/owner";
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
  if (!wish) {
    const t = await getTranslations();
    return (
      <main className="mx-auto flex min-h-dvh max-w-105 flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-mute">{t("detail.notFound")}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh max-w-105 px-6 pt-8 pb-10">
      <EditWishForm wish={wish} />
    </main>
  );
}
