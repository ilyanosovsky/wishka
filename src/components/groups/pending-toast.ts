/**
 * Four group outcomes are decided on one screen and have to be shown on the
 * next: leaving or deleting unmounts `/groups/<id>` before a toast could
 * appear, and joining or creating lands on a group screen that was never told
 * why it opened. The handoff goes through sessionStorage — written just before
 * the push, read once on the other side. Not a URL param: none of these should
 * be re-triggerable by reloading or sharing the address.
 */

const KEY = "wishka.groups.toast";

export type PendingGroupToast =
  | { kind: "left" }
  | { kind: "deleted" }
  /**
   * Both of these land on `/groups/<id>`, which claims the handoff only when
   * the id matches — a stale entry must not fire on whichever group the user
   * opens next. `created` is an instruction, not a confirmation: §6.7 ends
   * creation in the invite share sheet.
   */
  | { kind: "joined"; groupId: string }
  | { kind: "created"; groupId: string };

export function setPendingGroupToast(toast: PendingGroupToast): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(toast));
  } catch {
    // Storage can be denied (private mode, blocked cookies). The navigation is
    // the point; losing the confirmation toast is survivable.
  }
}

/** Reads and clears in one go, so a later visit to the screen stays quiet. */
export function takePendingGroupToast(): PendingGroupToast | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw === null) return null;
    window.sessionStorage.removeItem(KEY);
    return parse(raw);
  } catch {
    return null;
  }
}

function parse(raw: string): PendingGroupToast | null {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null) return null;
  const { kind, groupId } = value as { kind?: unknown; groupId?: unknown };
  if (kind === "left" || kind === "deleted") return { kind };
  if ((kind === "joined" || kind === "created") && typeof groupId === "string")
    return { kind, groupId };
  return null;
}
