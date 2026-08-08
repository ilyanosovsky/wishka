"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { GroupMark } from "@/components/groups/group-mark";
import { Avatar } from "@/components/ui/avatar";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import type { AudienceOptions } from "@/components/wishes/visibility-sheet";

/**
 * §6.6 «Посмотреть, как видят другие» — the trigger and its sheet in one
 * component, so the profile page (a server component) can drop it in without
 * owning any state.
 *
 * Nothing here reads a wish: the lens is only encoded into `?as=` and the
 * public list re-derives everything server-side through `getWishesAsSeenBy`,
 * which forces every wish to `free`. The preview can therefore never become a
 * back door onto the owner's own reservations (invariant #1).
 */

type Lens = "guest" | "group" | "person";

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export type ViewAsSheetProps = {
  /** The owner's own nickname — the preview target, `/u/<nickname>?as=…`. */
  nickname: string;
  /** The same candidate list the who-can-see-it sheet picks from. */
  candidates: AudienceOptions;
};

export function ViewAsSheet({ nickname, candidates }: ViewAsSheetProps) {
  const t = useTranslations();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [lens, setLens] = useState<Lens>("guest");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // BottomSheet keeps this mounted through its close transition, so the draft
  // is reset on open by the render-time recipe rather than an effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setLens("guest");
      setGroupId(null);
      setUserId(null);
    }
  }

  // A lens with nothing to pick is not a lens — the owner in no group can
  // only preview as a guest.
  const groupLensOffered = candidates.groups.length > 0;
  const personLensOffered = candidates.people.length > 0;

  const ready =
    lens === "guest" ||
    (lens === "group" && groupId !== null) ||
    (lens === "person" && userId !== null);

  function openPreview() {
    if (!ready) return;
    const as =
      lens === "guest"
        ? "guest"
        : lens === "group"
          ? `group:${groupId}`
          : `user:${userId}`;
    setOpen(false);
    router.push(`/u/${nickname}?as=${encodeURIComponent(as)}`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-fit cursor-pointer text-left text-[12px] font-medium text-accent underline"
      >
        {t("viewAs.cta")}
      </button>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title={t("viewAs.title")}
        footer={
          <>
            <Button className="flex-1" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              className={cx(
                "flex-1",
                !ready && "cursor-not-allowed opacity-60",
              )}
              aria-disabled={!ready}
              onClick={openPreview}
            >
              {t("viewAs.open")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2 pb-1">
          <div role="radiogroup" aria-label={t("viewAs.title")}>
            <LensRow
              label={t("viewAs.guest")}
              active={lens === "guest"}
              onClick={() => setLens("guest")}
            />
            {groupLensOffered && (
              <LensRow
                label={t("viewAs.groupLens")}
                active={lens === "group"}
                onClick={() => setLens("group")}
              />
            )}
            {personLensOffered && (
              <LensRow
                label={t("viewAs.personLens")}
                active={lens === "person"}
                onClick={() => setLens("person")}
              />
            )}
          </div>

          {lens === "group" && (
            <Picker label={t("viewAs.pickGroup")}>
              {candidates.groups.map((group) => (
                <PickRow
                  key={group.id}
                  label={group.name}
                  selected={groupId === group.id}
                  onClick={() => setGroupId(group.id)}
                  mark={
                    <GroupMark
                      name={group.name}
                      emoji={group.emoji}
                      color={group.color}
                    />
                  }
                />
              ))}
            </Picker>
          )}

          {lens === "person" && (
            <Picker label={t("viewAs.pickPerson")}>
              {candidates.people.map((person) => (
                <PickRow
                  key={person.userId}
                  label={person.name}
                  selected={userId === person.userId}
                  onClick={() => setUserId(person.userId)}
                  mark={
                    <Avatar size="md" name={person.name} src={person.image} />
                  }
                />
              ))}
            </Picker>
          )}

          <p className="pt-1 text-[11px] leading-[1.4] text-mute">
            {t("viewAs.note")}
          </p>
        </div>
      </BottomSheet>
    </>
  );
}

function Picker({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="pt-2 pb-1 font-mono text-[9.5px] font-semibold tracking-[0.1em] text-mute-2 uppercase">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex max-h-[40vh] flex-col overflow-y-auto"
      >
        {children}
      </div>
    </div>
  );
}

function LensRow({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cx(
        "flex min-h-11 w-full cursor-pointer items-center gap-2.5 border-t border-rule text-[13px] first:border-t-0",
        active && "font-semibold",
      )}
    >
      <span className="flex-1 text-left">{label}</span>
      {active && (
        <Check
          aria-hidden
          size={14}
          strokeWidth={2.6}
          className="flex-none text-accent"
        />
      )}
    </button>
  );
}

function PickRow({
  label,
  selected,
  onClick,
  mark,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  mark: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cx(
        "flex min-h-11 w-full cursor-pointer items-center gap-2.5 border-t border-rule py-1.5 text-[13px] first:border-t-0",
        selected && "font-semibold",
      )}
    >
      {mark}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {selected && (
        <Check
          aria-hidden
          size={14}
          strokeWidth={2.6}
          className="flex-none text-accent"
        />
      )}
    </button>
  );
}
