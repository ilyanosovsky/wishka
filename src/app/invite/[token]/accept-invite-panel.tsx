"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { AlertBanner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { acceptInviteAction } from "./actions";

/**
 * The one interactive state of `/invite/<token>` — signed in, not yet a
 * member. A failure stays on this screen (AlertBanner) rather than bouncing
 * to a generic error page: the token is still good, so retrying in place is
 * the honest recovery path.
 */
export function AcceptInvitePanel({
  token,
  groupName,
  groupEmoji,
}: {
  token: string;
  groupName: string;
  groupEmoji: string | null;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function accept() {
    if (pending) return;
    setFailed(false);
    setPending(true);
    const result = await acceptInviteAction(token);
    if (result.ok) {
      router.push(`/groups/${result.groupId}`);
      return;
    }
    // `expired`/`revoked`/`not_found` here means the invite died between page
    // load and the tap (a double-tap race, or an admin revoking meanwhile) —
    // there's no group to land on, so send them to the same dead end the
    // page itself would have shown for that state.
    if (result.state === "unauthenticated") {
      router.push(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
      return;
    }
    if (
      result.state === "not_found" ||
      result.state === "expired" ||
      result.state === "revoked"
    ) {
      router.push("/");
      return;
    }
    setFailed(true);
    setPending(false);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-105 flex-col items-center justify-center gap-5 px-6 text-center">
      {groupEmoji && (
        <span className="text-[40px] leading-none">{groupEmoji}</span>
      )}
      <h1 className="font-serif text-[19px] font-semibold">
        {t("invite.title", { name: groupName })}
      </h1>
      <p className="text-mute" style={{ lineHeight: "var(--lead-prose)" }}>
        {t("invite.body")}
      </p>
      {failed && (
        <AlertBanner tone="error" className="w-full text-left">
          {t("invite.failed")}
        </AlertBanner>
      )}
      <Button
        variant="primary"
        className="w-full"
        loading={pending}
        onClick={() => void accept()}
      >
        {pending ? t("invite.joining") : t("invite.accept")}
      </Button>
    </main>
  );
}
