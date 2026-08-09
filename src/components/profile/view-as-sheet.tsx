"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { GroupMark } from "@/components/groups/group-mark";
import { Avatar } from "@/components/ui/avatar";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { useRovingRadio } from "@/components/ui/use-roving-radio";
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

  // Arrow keys + one tab stop per radiogroup (a11y): the lens strip and both
  // pickers are radio groups, so they have to behave like radio groups.
  const offeredLenses: Lens[] = [
    "guest",
    ...(groupLensOffered ? (["group"] as const) : []),
    ...(personLensOffered ? (["person"] as const) : []),
  ];
  const lensRoving = useRovingRadio<Lens>({
    values: offeredLenses,
    value: lens,
    onChange: setLens,
  });
  const groupRoving = useRovingRadio<string>({
    values: candidates.groups.map((group) => group.id),
    value: groupId,
    onChange: setGroupId,
  });
  const personRoving = useRovingRadio<string>({
    values: candidates.people.map((person) => person.userId),
    value: userId,
    onChange: setUserId,
  });

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
        className="inline-flex min-h-11 w-fit cursor-pointer items-center text-left text-[12px] font-medium text-accent underline"
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
          <div
            role="radiogroup"
            aria-label={t("viewAs.title")}
            onKeyDown={lensRoving.onKeyDown}
          >
            <LensRow
              label={t("viewAs.guest")}
              active={lens === "guest"}
              onClick={() => setLens("guest")}
              tabIndex={lensRoving.tabIndex("guest")}
              itemRef={lensRoving.itemRef("guest")}
            />
            {groupLensOffered && (
              <LensRow
                label={t("viewAs.groupLens")}
                active={lens === "group"}
                onClick={() => setLens("group")}
                tabIndex={lensRoving.tabIndex("group")}
                itemRef={lensRoving.itemRef("group")}
              />
            )}
            {personLensOffered && (
              <LensRow
                label={t("viewAs.personLens")}
                active={lens === "person"}
                onClick={() => setLens("person")}
                tabIndex={lensRoving.tabIndex("person")}
                itemRef={lensRoving.itemRef("person")}
              />
            )}
          </div>

          {lens === "group" && (
            <Picker
              label={t("viewAs.pickGroup")}
              onKeyDown={groupRoving.onKeyDown}
            >
              {candidates.groups.map((group) => (
                <PickRow
                  key={group.id}
                  label={group.name}
                  selected={groupId === group.id}
                  onClick={() => setGroupId(group.id)}
                  tabIndex={groupRoving.tabIndex(group.id)}
                  itemRef={groupRoving.itemRef(group.id)}
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
            <Picker
              label={t("viewAs.pickPerson")}
              onKeyDown={personRoving.onKeyDown}
            >
              {candidates.people.map((person) => (
                <PickRow
                  key={person.userId}
                  label={person.name}
                  selected={userId === person.userId}
                  onClick={() => setUserId(person.userId)}
                  tabIndex={personRoving.tabIndex(person.userId)}
                  itemRef={personRoving.itemRef(person.userId)}
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

function Picker({
  label,
  onKeyDown,
  children,
}: {
  label: string;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <span className="pt-2 pb-1 font-mono text-[9.5px] font-semibold tracking-[0.1em] text-mute-2 uppercase">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-label={label}
        onKeyDown={onKeyDown}
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
  tabIndex,
  itemRef,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  tabIndex: 0 | -1;
  itemRef: (node: HTMLElement | null) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      ref={itemRef}
      tabIndex={tabIndex}
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
  tabIndex,
  itemRef,
  mark,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  tabIndex: 0 | -1;
  itemRef: (node: HTMLElement | null) => void;
  mark: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      ref={itemRef}
      tabIndex={tabIndex}
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
