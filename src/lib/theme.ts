export const THEME_STORAGE_KEY = "wishka-theme";

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

export function isTheme(value: unknown): value is Theme {
  return (
    typeof value === "string" && (THEMES as readonly string[]).includes(value)
  );
}

/** Read the persisted preference; anything invalid falls back to "system". */
export function getStoredTheme(storage: Pick<Storage, "getItem">): Theme {
  const raw = storage.getItem(THEME_STORAGE_KEY);
  return isTheme(raw) ? raw : "system";
}

const listeners = new Set<() => void>();

/** Subscribe to theme changes (for useSyncExternalStore). */
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Snapshot for useSyncExternalStore; null on the server (unknowable there). */
export function getThemeSnapshot(): Theme {
  return getStoredTheme(window.localStorage);
}

export function getServerThemeSnapshot(): Theme | null {
  return null;
}

/** Persist the preference, stamp it on <html data-theme>, notify subscribers. */
export function applyTheme(theme: Theme): void {
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  document.documentElement.dataset.theme = theme;
  listeners.forEach((listener) => listener());
}

/**
 * Runs before paint (inlined in layout.tsx) so the page never flashes the
 * wrong theme. Must stay dependency-free and ES5-safe.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t!=="light"&&t!=="dark"&&t!=="system")t="system";document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="system";}})();`;
