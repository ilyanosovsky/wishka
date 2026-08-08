/**
 * "Recently viewed lists" (DESIGN_BRIEF §6.7) — a device-local trail of
 * the public lists this browser has opened, so a link followed once stays
 * findable afterwards.
 *
 * Deliberately localStorage-only. A visitor may be a guest with no account to
 * hang this on, and "which lists did you look at" is browsing history we have
 * no reason to keep server-side. Everything here is defensive: the store is
 * user-writable, so a hand-edited or half-written value must degrade to an
 * empty list, never throw on a render path.
 */

export type RecentList = {
  nickname: string;
  /** Display name at visit time — what the list header showed. */
  name: string;
  /** Epoch ms of the most recent visit. The list is newest-first. */
  at: number;
};

export const RECENT_LISTS_KEY = "wishka-recent-lists";
export const RECENT_LISTS_MAX = 8;

function parseEntry(value: unknown): RecentList | null {
  if (typeof value !== "object" || value === null) return null;
  const { nickname, name, at } = value as Record<string, unknown>;
  if (typeof nickname !== "string" || nickname.trim() === "") return null;
  if (typeof name !== "string") return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  return { nickname: nickname.trim(), name, at };
}

/** Anything → a sane newest-first, deduped, capped list. Pure. */
export function normalizeRecentLists(raw: unknown): RecentList[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const entries: RecentList[] = [];
  for (const item of raw) {
    const entry = parseEntry(item);
    if (!entry || seen.has(entry.nickname)) continue;
    seen.add(entry.nickname);
    entries.push(entry);
  }

  return entries.sort((a, b) => b.at - a.at).slice(0, RECENT_LISTS_MAX);
}

/** Moves `entry` to the front, replacing any earlier visit of the same list. Pure. */
export function upsertRecentList(
  entries: RecentList[],
  entry: { nickname: string; name: string },
  at: number,
): RecentList[] {
  const nickname = entry.nickname.trim();
  if (!nickname) return entries;
  return [
    { nickname, name: entry.name, at },
    ...entries.filter((existing) => existing.nickname !== nickname),
  ].slice(0, RECENT_LISTS_MAX);
}

/** localStorage can throw outright (Safari private mode, storage disabled), so
 *  every access is wrapped — a broken store simply means "no recent lists". */
function readRawString(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(RECENT_LISTS_KEY);
  } catch {
    return null;
  }
}

function parseRaw(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const EMPTY: RecentList[] = [];

/**
 * `useSyncExternalStore` demands a snapshot that is referentially stable while
 * the underlying store hasn't changed, or the component re-renders forever.
 * The raw string doubles as the cache key: same string, same array instance.
 */
let cachedRaw: string | null | undefined;
let cachedValue: RecentList[] = EMPTY;

export function readRecentLists(): RecentList[] {
  if (typeof window === "undefined") return EMPTY;
  const raw = readRawString();
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  cachedValue = normalizeRecentLists(parseRaw(raw));
  return cachedValue;
}

/** Server render has no store — always the same empty instance, so React can
 *  hydrate and then swap in the real list. */
export function getRecentListsServerSnapshot(): RecentList[] {
  return EMPTY;
}

/** Only cross-tab writes fire `storage`; a same-tab write happens on a page
 *  this component isn't mounted on, so there is nothing else to listen for. */
export function subscribeToRecentLists(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** Records a visit and returns the new list. No-op outside the browser. */
export function recordRecentList(
  entry: { nickname: string; name: string },
  at: number = Date.now(),
): RecentList[] {
  if (typeof window === "undefined") return [];
  const next = upsertRecentList(readRecentLists(), entry, at);
  try {
    window.localStorage.setItem(RECENT_LISTS_KEY, JSON.stringify(next));
  } catch {
    // Quota or a disabled store — the visit just isn't remembered.
  }
  return next;
}
