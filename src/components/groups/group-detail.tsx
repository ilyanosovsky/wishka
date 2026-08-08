"use client";

import { ArrowLeft, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  createInviteLinkAction,
  deleteGroupAction,
  leaveGroupAction,
  removeMemberAction,
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
import { setPendingGroupToast } from "./pending-toast";

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
type Notice = "saved" | "removed" | "failed";

export function GroupDetail({ group, viewerId }: GroupDetailProps) {
  const t = useTranslations();
  const router = useRouter();
  const isAdmin = group.role === "admin";

  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
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

  async function openInviteLink() {
    setBusy(true);
    try {
      const result = await createInviteLinkAction(group.id);
      if (!result.ok) {
        settle("failed");
        return;
      }
      setBusy(false);
      setMenuOpen(false);
      setShareUrl(result.url);
    } catch {
      settle("failed");
    }
  }

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

  /** Leave and delete both land on /people, where the toast is picked up. */
  async function runExit(kind: "left" | "deleted") {
    setBusy(true);
    try {
      const result =
        kind === "left"
          ? await leaveGroupAction(group.id)
          : await deleteGroupAction(group.id);
      if (!result.ok) {
        setLeaveOpen(false);
        setDeleteOpen(false);
        settle("failed");
        return;
      }
      setPendingGroupToast(kind);
      router.push("/people");
    } catch {
      setLeaveOpen(false);
      setDeleteOpen(false);
      settle("failed");
    }
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    setBusy(true);
    try {
      const result = await removeMemberAction(group.id, removeTarget.userId);
      setRemoveTarget(null);
      if (result.ok) {
        settle("removed");
        router.refresh();
        return;
      }
      settle("failed");
    } catch {
      setRemoveTarget(null);
      settle("failed");
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-105 flex-col px-5 pt-14 pb-16">
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
            {t("groups.membersCount", { count: group.members.length })}
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

      <ul className="flex flex-col pt-1.5">
        {group.members.map((member) => (
          <MemberRow
            key={member.userId}
            member={member}
            isSelf={member.userId === viewerId}
            canRemove={isAdmin && member.userId !== viewerId}
            onRemove={() => setRemoveTarget(member)}
          />
        ))}
      </ul>

      {/* v2 slot (§6.7). Dashed and muted so it reads as "not yet", not "broken". */}
      <section className="mt-6 border border-dashed border-rule-2 bg-zebra px-3.5 py-3">
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
            onClick={() => void openInviteLink()}
          />
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
        message={
          notice === "saved"
            ? t("groups.saved")
            : notice === "removed"
              ? t("groups.removedToast")
              : t("common.actionFailed")
        }
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
  onRemove,
}: {
  member: GroupMember;
  isSelf: boolean;
  canRemove: boolean;
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
          onClick={onRemove}
          className="min-h-11 flex-none cursor-pointer px-2 text-[12.5px] font-semibold text-neg"
        >
          {t("removeMember")}
        </button>
      )}
    </li>
  );
}
