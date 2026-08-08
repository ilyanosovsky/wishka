/**
 * Leaving or deleting a group navigates away from `/groups/<id>`, which unmounts
 * the screen that would have shown the confirmation. The toast is therefore
 * handed to `/people` through sessionStorage: written just before the push,
 * read once on the other side. Not a URL param — the outcome is nothing the
 * user should be able to re-trigger by reloading or sharing the address.
 */

const KEY = "wishka.groups.toast";

export type PendingGroupToast = "left" | "deleted";

export function setPendingGroupToast(kind: PendingGroupToast): void {
  try {
    window.sessionStorage.setItem(KEY, kind);
  } catch {
    // Storage can be denied (private mode, blocked cookies). The navigation is
    // the point; losing the confirmation toast is survivable.
  }
}

/** Reads and clears in one go, so a later visit to /people stays quiet. */
export function takePendingGroupToast(): PendingGroupToast | null {
  try {
    const value = window.sessionStorage.getItem(KEY);
    if (value === null) return null;
    window.sessionStorage.removeItem(KEY);
    return value === "left" || value === "deleted" ? value : null;
  } catch {
    return null;
  }
}
