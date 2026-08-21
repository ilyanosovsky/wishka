"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { AvatarGroup } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { InfoToast } from "@/components/ui/toast";
import type { GroupSummary } from "@/db/access/groups";
import { CreateGroupSheet } from "./create-group-sheet";
import { GroupMark } from "./group-mark";
import { takePendingGroupToast, type PendingGroupToast } from "./pending-toast";

/**
 * The Groups tab of «Люди» (§6.7).
 *
 * The empty state offers both directions a group can start from: creating one,
 * or arriving through someone else's invite. There is no code field — invites
 * are links only — so «У меня есть приглашение» explains rather than collects.
 */

/** The two outcomes that end on this screen; the rest land on a group. */
type ExitToast = Extract<
  PendingGroupToast,
  { kind: "left" | "deleted" }
>["kind"];

const TOAST_KEY: Record<ExitToast, string> = {
  left: "leftToast",
  deleted: "deletedToast",
};

export type GroupsTabProps = {
  groups: GroupSummary[];
};

export function GroupsTab({ groups }: GroupsTabProps) {
  const t = useTranslations("groups");
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteHintOpen, setInviteHintOpen] = useState(false);
  const [toast, setToast] = useState<ExitToast | null>(null);

  // The leave/delete confirmation is handed over from the group screen that no
  // longer exists by the time this renders. sessionStorage is not knowable
  // while rendering on the server, so it is claimed after mount (indirection
  // keeps the setState out of the effect body, per house style).
  useEffect(() => {
    const claim = () => {
      const handoff = takePendingGroupToast();
      if (handoff?.kind === "left" || handoff?.kind === "deleted")
        setToast(handoff.kind);
    };
    claim();
  }, []);

  return (
    <>
      {groups.length === 0 ? (
        <section className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
          <p className="font-serif text-[17px] font-semibold">
            {t("emptyTitle")}
          </p>
          <p className="max-w-72 text-mute">{t("emptyBody")}</p>
          <Button
            variant="primary"
            className="mt-1"
            onClick={() => setCreateOpen(true)}
          >
            {t("create")}
          </Button>
          <Button
            variant="ghost"
            aria-expanded={inviteHintOpen}
            onClick={() => setInviteHintOpen((open) => !open)}
          >
            {t("haveInvite")}
          </Button>
          {inviteHintOpen && (
            <p className="max-w-72 text-[12.5px] text-mute-2">
              {t("haveInviteHint")}
            </p>
          )}
        </section>
      ) : (
        <section className="flex flex-1 flex-col gap-2">
          <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2 lg:gap-3">
            {groups.map((group) => (
              <li key={group.id}>
                <Link
                  href={`/groups/${group.id}`}
                  className="flex min-h-11 items-center gap-3 border border-rule-2 bg-paper p-2.5 lg:min-h-20 lg:p-3.5"
                >
                  <GroupMark
                    name={group.name}
                    emoji={group.emoji}
                    color={group.color}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-serif text-[15px] font-semibold">
                      {group.name}
                    </span>
                    <span className="mt-px block font-mono text-[10px] tracking-[0.08em] text-mute uppercase">
                      <span>
                        {t("membersCount", { count: group.memberCount })}
                      </span>
                      {group.role === "admin" && <> · {t("youAdmin")}</>}
                    </span>
                  </span>
                  {/* Faces before the count: «карточки с аватарками» (§6.7). */}
                  {group.memberAvatars.length > 0 && (
                    <AvatarGroup
                      className="flex-none"
                      max={3}
                      avatars={group.memberAvatars.map((member) => ({
                        src: member.image,
                        name: member.name,
                      }))}
                    />
                  )}
                  <ChevronRight
                    aria-hidden
                    size={16}
                    strokeWidth={2.4}
                    className="flex-none text-mute-2"
                  />
                </Link>
              </li>
            ))}
          </ul>
          <Button
            className="mt-1 self-start"
            onClick={() => setCreateOpen(true)}
          >
            {t("create")}
          </Button>
        </section>
      )}

      <CreateGroupSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />

      <InfoToast
        open={toast !== null}
        message={toast ? t(TOAST_KEY[toast]) : ""}
        onDismiss={() => setToast(null)}
      />
    </>
  );
}
