"use client";

import { ArrowLeft, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import {
  createInviteLinkAction,
  deleteGroupAction,
  leaveGroupAction,
  removeMemberAction,
  revokeInviteLinkAction,
  updateGroupAction,
} from "@/app/groups/actions";
import { Avatar } from "@/components/ui/avatar";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { TagChip } from "@/components/ui/chip";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/field";
import { InfoToast } from "@/components/ui/toast";
import { ShareSheet } from "@/components/wishes/share-sheet";
import type {
  GroupDetail as GroupDetailData,
  GroupMember,
} from "@/db/access/groups";
import { GroupAppearanceFields } from "./group-appearance-fields";
import { GroupMark } from "./group-mark";
import { setPendingGroupToast, takePendingGroupToast } from "./pending-toast";

/**
 * Group detail (§6.7): who is in it, how to invite, and how to get out.
 *
 * Membership is visibility — every confirmation here spells out that a wish
 * restricted to this group stops being reachable for whoever is leaving or
 * being removed. Rename and appearance are open to any member; deleting the
 * group and removing someone are admin-only, and the menu simply does not
 * offer what the viewer may not do.
 */

export type GroupDetailProps = {
  group: GroupDetailData;
  viewerId: string;
};

/** Which confirmation toast is up — only one can be, they are all transient. */
type Notice = "saved" | "removed" | "revoked" | "joined" | "failed";

export function GroupDetail({ group, viewerId }: GroupDetailProps) {
  const t = useTranslations();
  const router = useRouter();
  const isAdmin = group.role === "admin";

  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<GroupMember | null>(null);

  const [name, setName] = useState(group.name);
  const [nameError, setNameError] = useState(false);
  const [emoji, setEmoji] = useState(group.emoji);
  const [color, setColor] = useState(group.color);

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  /** Every mutation ends the same way: stop the spinner, say what happened. */
  function settle(next: Notice | null) {
    setBusy(false);
    setNotice(next);
  }

  function noticeMessage(current: Notice): string {
    switch (current) {
      case "saved":
        return t("groups.saved");
      case "removed":
        return t("groups.removedToast");
      case "revoked":
        return t("groups.revokedToast");
      case "joined":
        return t("invite.joinedToast", { name: group.name });
      case "failed":
        return t("common.actionFailed");
    }
  }

  /**
   * Mints (or reuses) the group's live invite link and shares it. Kept stable
   * so the arrival-from-creation effect below can call the same path the
   * «Пригласить» button does; it therefore sets state directly instead of
   * going through `settle`.
   */
  const revealInviteLink = useCallback(async () => {
    setBusy(true);
    try {
      const result = await createInviteLinkAction(group.id);
      setBusy(false);
      if (!result.ok) {
        setNotice("failed");
        return;
      }
      setShareUrl(result.url);
    } catch {
      setBusy(false);
      setNotice("failed");
    }
  }, [group.id]);

  // Creating a group and accepting an invite both land here from a screen that
  // has already unmounted. Creation asks for the share sheet (§6.7: «создание →
  // ссылка-приглашение»), joining only for its confirmation; the id guard keeps
  // a stale entry from firing on a different group.
  useEffect(() => {
    const claim = () => {
      const handoff = takePendingGroupToast();
      if (handoff === null || !("groupId" in handoff)) return;
      if (handoff.groupId !== group.id) return;
      if (handoff.kind === "joined") setNotice("joined");
      else void revealInviteLink();
    };
    claim();
  }, [group.id, revealInviteLink]);

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(true);
      return;
    }
    setBusy(true);
    try {
      const result = await updateGroupAction(group.id, { name: trimmed });
      if (result.ok) {
        setRenameOpen(false);
        settle("saved");
        router.refresh();
        return;
      }
      setBusy(false);
      if (result.error === "name") setNameError(true);
      else settle("failed");
    } catch {
      settle("failed");
    }
  }

  async function saveAppearance() {
    setBusy(true);
    try {
      const result = await updateGroupAction(group.id, { emoji, color });
      if (result.ok) {
        setAppearanceOpen(false);
        settle("saved");
        router.refresh();
        return;
      }
      settle("failed");
    } catch {
      settle("failed");
    }
  }

  /**
   * Leave and delete both land on /people, where the toast is picked up. The
   * dialog closes before the round trip and `busy` blocks re-entry: a second
   * tap on a slow connection would otherwise report a failure for an action
   * that in fact succeeded.
   */
  async function runExit(kind: "left" | "deleted") {
    if (busy) return;
    setBusy(true);
    setLeaveOpen(false);
    setDeleteOpen(false);
    try {
      const result =
        kind === "left"
          ? await leaveGroupAction(group.id)
          : await deleteGroupAction(group.id);
      if (!result.ok) {
        settle("failed");
        return;
      }
      setPendingGroupToast({ kind });
      router.push("/people");
    } catch {
      settle("failed");
    }
  }

  async function confirmRemove() {
    if (busy || !removeTarget) return;
    const member = removeTarget;
    setBusy(true);
    setRemoveTarget(null);
    try {
      const result = await removeMemberAction(group.id, member.userId);
      if (result.ok) {
        settle("removed");
        router.refresh();
        return;
      }
      settle("failed");
    } catch {
      settle("failed");
    }
  }

  async function confirmRevoke() {
    if (busy) return;
    setBusy(true);
    setRevokeOpen(false);
    try {
      const result = await revokeInviteLinkAction(group.id);
      settle(result.ok ? "revoked" : "failed");
    } catch {
      settle("failed");
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-105 flex-col px-5 pt-14 pb-16 lg:max-w-5xl lg:px-8 lg:pt-8 lg:pb-12">
      <Link
        href="/people"
        className="inline-flex min-h-11 items-center gap-1.5 self-start text-[12.5px] text-mute"
      >
        <ArrowLeft aria-hidden size={16} strokeWidth={2.4} />
        {t("groups.back")}
      </Link>

      <header className="flex items-center gap-3 border-b-2 border-ink pt-1 pb-3.5">
        <GroupMark
          name={group.name}
          emoji={group.emoji}
          color={group.color}
          size="lg"
        />
        <div className="min-w-0 flex-1">
          <h1
            className="truncate font-serif text-[21px] font-semibold tracking-[-0.01em]"
            style={{ lineHeight: "var(--lead-tight)" }}
          >
            {group.name}
          </h1>
          <p className="mt-px font-mono text-[10px] tracking-[0.08em] text-mute uppercase">
            <span>
              {t("groups.membersCount", { count: group.members.length })}
            </span>
            {isAdmin && <> · {t("groups.youAdmin")}</>}
          </p>
        </div>
        <button
          type="button"
          aria-label={t("groups.menuLabel")}
          onClick={() => setMenuOpen(true)}
          className="flex h-11 w-11 flex-none items-center justify-center border border-rule-2 bg-paper text-mute"
        >
          <MoreHorizontal aria-hidden size={18} strokeWidth={2.4} />
        </button>
      </header>

      <ul className="grid grid-cols-1 pt-1.5 lg:grid-cols-2 lg:gap-x-6">
        {group.members.map((member) => (
          <MemberRow
            key={member.userId}
            member={member}
            isSelf={member.userId === viewerId}
            canRemove={isAdmin && member.userId !== viewerId}
            busy={busy}
            onRemove={() => setRemoveTarget(member)}
          />
        ))}
      </ul>

      {/* A group of one has nothing to show yet, so the invite is the screen's
          only real next step — it says so instead of hiding in the menu. */}
      <div className="flex flex-col items-start gap-1.5 pt-3">
        <Button loading={busy} onClick={() => void revealInviteLink()}>
          {t("groups.invite")}
        </Button>
        {group.members.length === 1 && (
          <p className="text-[12.5px] text-mute-2">{t("groups.inviteHint")}</p>
        )}
      </div>

      {/* v2 slot (§6.7). Dashed and muted so it reads as "not yet", not "broken". */}
      <section className="mt-6 border border-dashed border-rule-2 bg-zebra px-3.5 py-3 lg:max-w-2xl">
        <h2 className="font-serif text-[14px] font-semibold text-mute">
          {t("groups.soonTitle")}
        </h2>
        <p className="pt-1 text-[12.5px] text-mute-2">{t("groups.soonBody")}</p>
      </section>

      <BottomSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={t("groups.menuLabel")}
      >
        <div className="flex flex-col">
          <MenuRow
            label={t("groups.inviteLink")}
            disabled={busy}
            onClick={() => {
              setMenuOpen(false);
              void revealInviteLink();
            }}
          />
          {/* Only an admin may kill a leaked link — and only an admin is shown
              that it is possible. */}
          {isAdmin && (
            <MenuRow
              label={t("groups.revokeLink")}
              disabled={busy}
              onClick={() => {
                setMenuOpen(false);
                setRevokeOpen(true);
              }}
            />
          )}
          <MenuRow
            label={t("groups.rename")}
            onClick={() => {
              setName(group.name);
              setNameError(false);
              setMenuOpen(false);
              setRenameOpen(true);
            }}
          />
          <MenuRow
            label={t("groups.appearance")}
            onClick={() => {
              setEmoji(group.emoji);
              setColor(group.color);
              setMenuOpen(false);
              setAppearanceOpen(true);
            }}
          />
          <MenuRow
            label={t("groups.leave")}
            tone="destructive"
            onClick={() => {
              setMenuOpen(false);
              setLeaveOpen(true);
            }}
          />
          {isAdmin && (
            <MenuRow
              label={t("groups.deleteGroup")}
              tone="destructive"
              onClick={() => {
                setMenuOpen(false);
                setDeleteOpen(true);
              }}
            />
          )}
        </div>
      </BottomSheet>

      <BottomSheet
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title={t("groups.renameTitle")}
        footer={
          <>
            <Button
              className="flex-1"
              disabled={busy}
              onClick={() => setRenameOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              loading={busy}
              onClick={() => void saveName()}
            >
              {t("groups.save")}
            </Button>
          </>
        }
      >
        <TextField
          label={t("groups.nameLabel")}
          placeholder={t("groups.namePlaceholder")}
          value={name}
          error={nameError}
          helperText={t("groups.nameRequired")}
          maxLength={60}
          onChange={(event) => {
            setName(event.target.value);
            if (nameError) setNameError(false);
          }}
        />
      </BottomSheet>

      <BottomSheet
        open={appearanceOpen}
        onClose={() => setAppearanceOpen(false)}
        title={t("groups.appearanceTitle")}
        footer={
          <>
            <Button
              className="flex-1"
              disabled={busy}
              onClick={() => setAppearanceOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              loading={busy}
              onClick={() => void saveAppearance()}
            >
              {t("groups.save")}
            </Button>
          </>
        }
      >
        <GroupAppearanceFields
          emoji={emoji}
          color={color}
          onEmojiChange={setEmoji}
          onColorChange={setColor}
        />
      </BottomSheet>

      <Dialog
        open={leaveOpen}
        title={t("groups.leaveTitle")}
        description={t("groups.leaveBody")}
        onClose={() => setLeaveOpen(false)}
        actions={[
          {
            label: t("common.cancel"),
            tone: "neutral",
            onClick: () => setLeaveOpen(false),
          },
          {
            label: t("groups.leaveConfirm"),
            tone: "destructive",
            onClick: () => void runExit("left"),
          },
        ]}
      />

      <Dialog
        open={deleteOpen}
        title={t("groups.deleteTitle")}
        description={t("groups.deleteBody")}
        onClose={() => setDeleteOpen(false)}
        actions={[
          {
            label: t("common.cancel"),
            tone: "neutral",
            onClick: () => setDeleteOpen(false),
          },
          {
            label: t("common.delete"),
            tone: "destructive",
            onClick: () => void runExit("deleted"),
          },
        ]}
      />

      <Dialog
        open={revokeOpen}
        title={t("groups.revokeTitle")}
        description={t("groups.revokeBody")}
        onClose={() => setRevokeOpen(false)}
        actions={[
          {
            label: t("common.cancel"),
            tone: "neutral",
            onClick: () => setRevokeOpen(false),
          },
          {
            label: t("groups.revokeLink"),
            tone: "destructive",
            onClick: () => void confirmRevoke(),
          },
        ]}
      />

      <Dialog
        open={removeTarget !== null}
        title={t("groups.removeTitle")}
        description={t("groups.removeBody")}
        onClose={() => setRemoveTarget(null)}
        actions={[
          {
            label: t("common.cancel"),
            tone: "neutral",
            onClick: () => setRemoveTarget(null),
          },
          {
            label: t("groups.removeMember"),
            tone: "destructive",
            onClick: () => void confirmRemove(),
          },
        ]}
      />

      {shareUrl !== null && (
        <ShareSheet
          open
          kind="group"
          url={shareUrl}
          onClose={() => setShareUrl(null)}
        />
      )}

      <InfoToast
        open={notice !== null}
        message={notice === null ? "" : noticeMessage(notice)}
        onDismiss={() => setNotice(null)}
      />
    </main>
  );
}

function MenuRow({
  label,
  tone = "neutral",
  disabled = false,
  onClick,
}: {
  label: string;
  tone?: "neutral" | "destructive";
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`min-h-11 border-b border-dashed border-rule-2 px-1 text-left text-[13.5px] last:border-b-0 disabled:opacity-60 ${
        tone === "destructive" ? "text-neg" : "text-ink"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * One member. `hasVisibleWishes` is computed for the *viewer*, so the link only
 * appears when there is genuinely something to open — a member with no public
 * nickname has no address at all, and reads the same muted way.
 */
function MemberRow({
  member,
  isSelf,
  canRemove,
  busy,
  onRemove,
}: {
  member: GroupMember;
  isSelf: boolean;
  canRemove: boolean;
  /** No second exclusion may be started while one is still in flight. */
  busy: boolean;
  onRemove: () => void;
}) {
  const t = useTranslations("groups");
  // The viewer's own row links nowhere: their list is the app's home screen.
  const listHref =
    !isSelf && member.hasVisibleWishes && member.nickname
      ? `/u/${encodeURIComponent(member.nickname)}`
      : null;

  const body = (
    <>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-[14px]">{member.name}</span>
        {isSelf && <TagChip className="flex-none">{t("youBadge")}</TagChip>}
        {member.role === "admin" && (
          <TagChip className="flex-none">{t("adminBadge")}</TagChip>
        )}
      </div>
      {!isSelf && (
        <span
          className={`mt-0.5 block text-[12px] ${
            listHref ? "text-accent" : "text-mute-2"
          }`}
        >
          {listHref ? t("memberOpenList") : t("memberEmptyList")}
        </span>
      )}
    </>
  );

  return (
    <li className="flex items-center gap-2.5 border-b border-dashed border-rule-2 py-2 last:border-b-0">
      <Avatar src={member.image} name={member.name} size="md" />
      {/* The whole name block is the tap target, not the 12px label alone. */}
      {listHref ? (
        <Link
          href={listHref}
          className="flex min-h-11 min-w-0 flex-1 flex-col justify-center"
        >
          {body}
        </Link>
      ) : (
        <div className="flex min-h-11 min-w-0 flex-1 flex-col justify-center">
          {body}
        </div>
      )}
      {canRemove && (
        <button
          type="button"
          disabled={busy}
          onClick={onRemove}
          className="min-h-11 flex-none cursor-pointer px-2 text-[12.5px] font-semibold text-neg disabled:opacity-60"
        >
          {t("removeMember")}
        </button>
      )}
    </li>
  );
}
