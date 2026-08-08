import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { GroupDetail } from "@/components/groups/group-detail";
import { ServiceScreen } from "@/components/service-screen";
import { getDb } from "@/db";
import { getGroupDetail } from "@/db/access/groups";
import { getAuth } from "@/lib/auth";
import { loginHrefWithNext } from "@/lib/next-param";

/**
 * A group (§6.7) — members only. `getGroupDetail` answers null both for a group
 * that does not exist and for one the viewer is not in, and this screen keeps
 * that indistinguishable: «Группа не найдена» either way, no 404 that would
 * confirm the id is real.
 */
export default async function GroupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session)
    redirect(loginHrefWithNext(`/groups/${encodeURIComponent(id)}`));

  const group = await getGroupDetail(getDb(), id, session.user.id);
  if (!group) {
    const t = await getTranslations("groups");
    return (
      <ServiceScreen
        title={t("notFoundTitle")}
        ctaLabel={t("notFoundCta")}
        ctaHref="/people"
      />
    );
  }

  return <GroupDetail group={group} viewerId={session.user.id} />;
}
