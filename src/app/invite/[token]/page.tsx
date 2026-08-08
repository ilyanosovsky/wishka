import Link from "next/link";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import { getDb } from "@/db";
import { isGroupMember } from "@/db/access/groups";
import { lookupInvite } from "@/db/access/group-invites";
import { getAuth } from "@/lib/auth";
import { loginHrefWithNext } from "@/lib/next-param";
import { ServiceScreen } from "@/components/service-screen";
import { AcceptInvitePanel } from "./accept-invite-panel";

/**
 * The link behind a group's "Ссылка-приглашение" (§6.7 / §6.10). Unlike the
 * guest manage-booking link (`/g/<token>`), this token is not a bearer secret
 * to stay quiet about — a group invite is meant to be shown and explained, so
 * `expired`/`revoked`/`not_found` each get their own honest dead end instead
 * of a silent redirect.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const db = getDb();
  const invite = await lookupInvite(db, token);
  const t = await getTranslations();

  // A `switch` on the discriminant (not a chain of `===` checks) is what lets
  // TypeScript narrow `invite` to the `"valid"` member below — the "expired" |
  // "revoked" | "not_found" member packs three tags into one object shape, so
  // equality checks alone don't eliminate it the way a real per-tag member
  // would.
  switch (invite.state) {
    case "expired":
    case "revoked":
      return (
        <ServiceScreen
          title={t("service.expiredInviteTitle")}
          ctaLabel={t("service.expiredInviteCta")}
          ctaHref="/"
        />
      );
    case "not_found":
      return (
        <ServiceScreen
          title={t("service.invalidLinkTitle")}
          ctaLabel={t("service.invalidLinkCta")}
          ctaHref="/"
        />
      );
  }

  const session = await getAuth().api.getSession({ headers: await headers() });

  if (!session) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-105 flex-col items-center justify-center gap-5 px-6 text-center">
        {invite.groupEmoji && (
          <span className="text-[40px] leading-none">{invite.groupEmoji}</span>
        )}
        <h1 className="font-serif text-[19px] font-semibold">
          {t("invite.title", { name: invite.groupName })}
        </h1>
        <p className="text-mute" style={{ lineHeight: "var(--lead-prose)" }}>
          {t("invite.body")}
        </p>
        <Link
          href={loginHrefWithNext(`/invite/${token}`)}
          className="inline-flex min-h-11 w-full items-center justify-center border border-accent bg-accent px-4 text-[13px] font-medium text-paper hover:bg-accent-ink"
        >
          {t("invite.signIn")}
        </Link>
      </main>
    );
  }

  const alreadyMember = await isGroupMember(
    db,
    invite.groupId,
    session.user.id,
  );
  if (alreadyMember) {
    return (
      <ServiceScreen
        title={t("invite.alreadyTitle", { name: invite.groupName })}
        ctaLabel={t("invite.alreadyCta")}
        ctaHref={`/groups/${invite.groupId}`}
      />
    );
  }

  return (
    <AcceptInvitePanel
      token={token}
      groupName={invite.groupName}
      groupEmoji={invite.groupEmoji}
    />
  );
}
