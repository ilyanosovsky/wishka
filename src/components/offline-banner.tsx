"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertBanner } from "@/components/ui/banner";

/**
 * Global connectivity banner (Phase 9 states-brief audit, finding #9).
 *
 * Previously `my-list.tsx` was the only place with a `navigator.onLine`
 * listener, so guest-facing routes reached from a shared link (`/u`, `/w`,
 * `/people`, `/profile`, `/archive`) showed nothing when connectivity
 * dropped. Mounted once in `layout.tsx` so every route gets it, above
 * `{children}` rather than inside any one page's `<main>`.
 */
export function OfflineBanner() {
  const t = useTranslations();
  const [offline, setOffline] = useState(false);

  // Read after mount only: `navigator.onLine` is not knowable while
  // rendering on the server, and guessing it would mismatch hydration.
  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="sticky top-0 z-40">
      <div className="mx-auto max-w-105 px-5 pt-3">
        <AlertBanner tone="warning">{t("list.offline")}</AlertBanner>
      </div>
    </div>
  );
}
