"use client";

import { Check, Search } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState, type ReactNode } from "react";
import { GroupMark } from "@/components/groups/group-mark";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Field } from "@/components/ui/field";

/**
 * The "who can see it" sheet (§6.3) — the only writer of a wish's audience.
 *
 * The types below mirror `WishAudience` / `AudienceCandidates` from
 * `src/db/access/visibility.ts` in shape only, the same way `WishFormValues`
 * mirrors `WishInput`: this file must stay importable without pulling the DB
 * layer into the client bundle. They are structurally identical, so a
 * server-fetched value passes straight in.
 *
 * Enforcement is *not* here — `setWishAudience` re-validates every subject
 * server-side (product invariant #2). This sheet only proposes.
 */

export type VisibilityMode = "everyone" | "restricted";

export type WishAudienceValue = {
  mode: VisibilityMode;
  groupIds: string[];
  userIds: string[];
};

export type AudienceGroupOption = {
  id: string;
  name: string;
  emoji: string | null;
  color: string | null;
};

export type AudiencePersonOption = {
  userId: string;
  name: string;
  image: string | null;
  /** Pinned to the top of the list (§6.3) and marked. */
  isPartner: boolean;
};

export type AudienceOptions = {
  groups: AudienceGroupOption[];
  people: AudiencePersonOption[];
};

export const EMPTY_AUDIENCE_OPTIONS: AudienceOptions = {
  groups: [],
  people: [],
};

export const EVERYONE_AUDIENCE: WishAudienceValue = {
  mode: "everyone",
  groupIds: [],
  userIds: [],
};

export function audienceSubjectCount(value: WishAudienceValue): number {
  return value.groupIds.length + value.userIds.length;
}

/**
 * The subjects of `value` this owner can still address, dropping the rest.
 *
 * A wish can name a group the owner has since left, or a person who has left
 * every shared group: the id is real, but it has no row in `candidates` to
 * untick, so carrying it into a draft would put it into every later confirm —
 * and the data layer rejects the whole write as `invalid_subject`, rolling back
 * the entire edit, not just the audience.
 *
 * The mode is left alone: a restricted wish never silently reopens to everyone
 * here. Dropping every subject leaves an audience the owner has to re-pick,
 * which is a visible, blocked state rather than a silent widening.
 */
export function addressableAudience(
  value: WishAudienceValue,
  candidates: AudienceOptions,
): WishAudienceValue {
  if (value.mode !== "restricted") return EVERYONE_AUDIENCE;
  const groups = new Set(candidates.groups.map((group) => group.id));
  const people = new Set(candidates.people.map((person) => person.userId));
  return {
    mode: "restricted",
    groupIds: value.groupIds.filter((id) => groups.has(id)),
    userIds: value.userIds.filter((id) => people.has(id)),
  };
}

/** The three modes §6.3 offers; `restricted` is split by subject kind here. */
type SheetMode = "everyone" | "groups" | "people";

/**
 * Which of the three rows a stored audience lands on. A restricted wish that
 * names groups is a "groups" wish even if it also named people — the sheet
 * writes one kind at a time, so this is only reachable for data written
 * elsewhere, and picking the groups row keeps the wider audience visible.
 */
function modeOf(value: WishAudienceValue): SheetMode {
  if (value.mode === "everyone") return "everyone";
  return value.groupIds.length > 0 ? "groups" : "people";
}

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export type VisibilitySheetProps = {
  open: boolean;
  onClose: () => void;
  value: WishAudienceValue;
  candidates: AudienceOptions;
  onConfirm: (value: WishAudienceValue) => void;
};

export function VisibilitySheet({
  open,
  onClose,
  value,
  candidates,
  onConfirm,
}: VisibilitySheetProps) {
  const t = useTranslations();

  // Only ids with a row to untick enter the draft (see `addressableAudience`);
  // the mode still follows the stored value, so a wish restricted to a group
  // the owner has left keeps offering the groups row.
  const seed = useMemo(
    () => addressableAudience(value, candidates),
    [value, candidates],
  );

  const [mode, setMode] = useState<SheetMode>(() => modeOf(value));
  const [groupIds, setGroupIds] = useState<string[]>(seed.groupIds);
  const [userIds, setUserIds] = useState<string[]>(seed.userIds);
  const [query, setQuery] = useState("");
  const [emptyAttempt, setEmptyAttempt] = useState(false);

  // The sheet stays mounted through its close transition, so the draft is
  // re-seeded from the saved value on every open — React's "adjust state
  // during render" recipe, as in `add-wish-sheet.tsx`, rather than an effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setMode(modeOf(value));
      setGroupIds(seed.groupIds);
      setUserIds(seed.userIds);
      setQuery("");
      setEmptyAttempt(false);
    }
  }

  // A wish can be restricted to a group the owner has since left: the mode
  // stays offered while it is the wish's current one, so confirming never
  // silently rewrites an audience this owner can no longer see.
  const groupsOffered = candidates.groups.length > 0 || mode === "groups";

  const normalizedQuery = query.trim().toLowerCase();
  const filteredPeople = useMemo(
    () =>
      candidates.people.filter(
        (person) =>
          !normalizedQuery ||
          person.name.toLowerCase().includes(normalizedQuery),
      ),
    [candidates.people, normalizedQuery],
  );

  const selectedCount = mode === "groups" ? groupIds.length : userIds.length;
  const showEmptyError =
    emptyAttempt && mode !== "everyone" && selectedCount === 0;

  function pickMode(next: SheetMode) {
    setMode(next);
    setEmptyAttempt(false);
  }

  function confirm() {
    if (mode === "everyone") {
      onConfirm(EVERYONE_AUDIENCE);
      onClose();
      return;
    }
    if (selectedCount === 0) {
      setEmptyAttempt(true);
      return;
    }
    // One subject kind per mode: the row the owner picked is the audience,
    // and the other list is dropped rather than kept invisibly.
    onConfirm({
      mode: "restricted",
      groupIds: mode === "groups" ? groupIds : [],
      userIds: mode === "people" ? userIds : [],
    });
    onClose();
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t("visibility.title")}
      footer={
        <>
          <Button className="flex-1" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" className="flex-1" onClick={confirm}>
            {t("visibility.done")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 pb-1">
        <div role="radiogroup" aria-label={t("visibility.title")}>
          <ModeRow
            label={t("visibility.everyone")}
            active={mode === "everyone"}
            onClick={() => pickMode("everyone")}
          />
          {groupsOffered && (
            <ModeRow
              label={t("visibility.groups")}
              active={mode === "groups"}
              onClick={() => pickMode("groups")}
            />
          )}
          <ModeRow
            label={t("visibility.people")}
            active={mode === "people"}
            onClick={() => pickMode("people")}
          />
        </div>

        {!groupsOffered && (
          <div className="flex flex-col gap-1 border border-dashed border-rule-2 bg-zebra px-3 py-2.5">
            <span className="text-[13px] font-semibold">
              {t("visibility.noGroups")}
            </span>
            <span className="text-[12px] leading-[1.4] text-mute">
              {t("visibility.noGroupsHint")}
            </span>
            <Link
              href="/people"
              className="w-fit pt-1 text-[13px] font-medium text-accent underline"
            >
              {t("visibility.createGroup")}
            </Link>
          </div>
        )}

        {mode === "groups" && (
          <div className="flex max-h-[45vh] flex-col overflow-y-auto">
            {candidates.groups.map((group) => (
              <SubjectRow
                key={group.id}
                label={group.name}
                selected={groupIds.includes(group.id)}
                onClick={() => setGroupIds((prev) => toggle(prev, group.id))}
                mark={
                  <GroupMark
                    name={group.name}
                    emoji={group.emoji}
                    color={group.color}
                  />
                }
              />
            ))}
          </div>
        )}

        {mode === "people" &&
          (candidates.people.length === 0 ? (
            <p className="py-2 text-[13px] text-mute">
              {t("visibility.noPeople")}
            </p>
          ) : (
            <>
              <div className="relative">
                <Search
                  aria-hidden
                  size={13}
                  strokeWidth={2.2}
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-mute-2"
                />
                <Field
                  aria-label={t("visibility.searchPeople")}
                  placeholder={t("visibility.searchPeople")}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="pl-8"
                />
              </div>
              <div className="flex max-h-[40vh] flex-col overflow-y-auto">
                {filteredPeople.map((person) => (
                  <SubjectRow
                    key={person.userId}
                    label={person.name}
                    meta={
                      person.isPartner ? t("visibility.partnerLabel") : null
                    }
                    selected={userIds.includes(person.userId)}
                    onClick={() =>
                      setUserIds((prev) => toggle(prev, person.userId))
                    }
                    mark={
                      <Avatar size="md" name={person.name} src={person.image} />
                    }
                  />
                ))}
              </div>
            </>
          ))}

        {showEmptyError && (
          <p className="text-[11px] text-neg">
            {t("visibility.emptyAudience")}
          </p>
        )}

        {/* Unconditional by invariant #1: a note that appeared only when a
            booking existed would tell the owner one exists. */}
        <p className="pt-1 text-[11px] leading-[1.4] text-mute">
          {t("visibility.narrowNote")}
        </p>
      </div>
    </BottomSheet>
  );
}

function ModeRow({
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

function SubjectRow({
  label,
  meta,
  selected,
  onClick,
  mark,
}: {
  label: string;
  meta?: string | null;
  selected: boolean;
  onClick: () => void;
  mark: ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={onClick}
      className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 border-t border-rule py-1.5 text-[13px] first:border-t-0"
    >
      {mark}
      <span className="min-w-0 flex-1 text-left">
        <span className={cx("block truncate", selected && "font-semibold")}>
          {label}
        </span>
        {meta && (
          <span className="block font-mono text-[10px] tracking-[0.08em] text-mute-2 uppercase">
            {meta}
          </span>
        )}
      </span>
      <span
        aria-hidden
        className={cx(
          "flex h-[18px] w-[18px] flex-none items-center justify-center border",
          selected ? "border-accent bg-accent text-paper" : "border-rule-2",
        )}
      >
        {selected && <Check size={12} strokeWidth={3} />}
      </span>
    </button>
  );
}
