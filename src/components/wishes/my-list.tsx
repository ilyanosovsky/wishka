"use client";

import { Archive, List, Search, Share2, User, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { generateWishImageAction } from "@/app/wishes/ai-actions";
import { updateWishAction } from "@/app/wishes/actions";
import {
  NullPill,
  PriorityFlag,
  VisibilityLockBadge,
} from "@/components/ui/badges";
import { AlertBanner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { SquareAvatar } from "@/components/ui/avatar";
import { FilterChip } from "@/components/ui/chip";
import { Fab } from "@/components/ui/fab";
import { Field } from "@/components/ui/field";
import { TabBar } from "@/components/ui/tab-bar";
import { Tabs } from "@/components/ui/tabs";
import { InfoToast } from "@/components/ui/toast";
import { WishCard } from "@/components/ui/wish-card";
import type { OwnerWish, WishPriority } from "@/db/access/types";
import type { AiQuotaSnapshot } from "@/lib/ai/types";
import { CATEGORY_KEYS } from "@/lib/categories";
import { formatPrice } from "@/lib/price";
import { useUploadThing } from "@/lib/uploadthing-client";
import { downscaleForWish } from "@/lib/wish-image";
import { AddWishSheet } from "./add-wish-sheet";
import { ShareSheet } from "./share-sheet";
import { toBaseWish } from "./wish-card-props";
import { WishImagePoller } from "./wish-image-poller";

/**
 * My List (Directions 3a "cards" / 3b "ledger").
 *
 * Read-only besides navigation and the card-level async image affordances
 * (Phase 6 §6.2: retry generation, upload a photo over a `failed` card) —
 * every other mutation lives on the detail screen, so those two are the only
 * server actions this component calls, and both just trigger a refresh
 * rather than keeping any optimistic state of their own.
 *
 * SURPRISE INVARIANT — it renders `OwnerWish`, which has no reservation field
 * to render, and picks `role="owner"` on every card, the one WishCard variant
 * whose props cannot carry booking data.
 */

export type MyListProps = {
  wishes: OwnerWish[];
  nickname: string;
  /** Server-computed AI availability + daily quota snapshot; undefined hides
   *  the "Добавь словами" entry in the add-wish sheet entirely. */
  ai?: AiQuotaSnapshot;
};

type SortKey = "newest" | "priority" | "price";
type ViewKey = "cards" | "ledger";
/** "all" | "dreams" | "cat:<category key>" */
type FilterKey = string;

const PRIORITY_RANK: Record<WishPriority, number> = {
  want: 0,
  nice: 1,
  idea: 2,
};

/** Ledger hatching for a wish with no photo, at thumbnail pitch. */
const PLACEHOLDER_STRIPES =
  "repeating-linear-gradient(45deg, var(--zebra) 0 6px, color-mix(in srgb, var(--rule) 40%, var(--zebra)) 6px 12px)";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

function priceValue(wish: OwnerWish): number | null {
  if (wish.priceType === "none" || wish.priceMin === null) return null;
  const value = Number(wish.priceMin);
  return Number.isFinite(value) ? value : null;
}

function matches(wish: OwnerWish, query: string): boolean {
  if (!query) return true;
  return [wish.title, wish.description, wish.notes].some((field) =>
    field?.toLowerCase().includes(query),
  );
}

export function MyList({ wishes, nickname, ai }: MyListProps) {
  const t = useTranslations();
  const router = useRouter();

  const [view, setView] = useState<ViewKey>("cards");
  const [sort, setSort] = useState<SortKey>("newest");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [offline, setOffline] = useState(false);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // Owner-only async image lifecycle (Phase 6 §6.2): retry re-arms
  // generation, upload swaps in a photo directly — both end in a refresh so
  // the server-computed `imageStatus` on the card is always what actually
  // landed, never an optimistic guess.
  const [imageReadyToast, setImageReadyToast] = useState(false);
  const [uploadTargetId, setUploadTargetId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { startUpload } = useUploadThing("wishImage");

  const generatingIds = useMemo(
    () =>
      wishes
        .filter((wish) => wish.imageStatus === "generating")
        .map((wish) => wish.id),
    [wishes],
  );

  function handleRetryImage(wishId: string) {
    void generateWishImageAction(wishId).finally(() => router.refresh());
  }

  function handleUploadImage(wishId: string) {
    setUploadTargetId(wishId);
    fileInputRef.current?.click();
  }

  const handleFileSelected = useCallback(
    async (file: File | undefined) => {
      const wishId = uploadTargetId;
      setUploadTargetId(null);
      if (!file || !wishId) return;
      try {
        const small = await downscaleForWish(file);
        const uploaded = await startUpload([small]);
        const url = uploaded?.[0]?.ufsUrl;
        if (!url) return;
        await updateWishAction(wishId, { imageUrl: url });
      } catch {
        // Best-effort — the card just stays on whatever the row already says.
      } finally {
        router.refresh();
      }
    },
    [uploadTargetId, startUpload, router],
  );

  const handleImageSettled = useCallback(
    (_wishId: string, status: "ready" | "failed") => {
      if (status === "ready") setImageReadyToast(true);
      router.refresh();
    },
    [router],
  );

  // Read after mount only: `navigator.onLine` is not knowable while rendering
  // on the server, and guessing it would mismatch hydration.
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

  /** Only categories actually present get a chip — an empty filter is noise. */
  const categories = useMemo(() => {
    const present = new Set(
      wishes.map((wish) => wish.category).filter(Boolean) as string[],
    );
    return CATEGORY_KEYS.filter((key) => present.has(key));
  }, [wishes]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = wishes.filter((wish) => {
      if (!matches(wish, needle)) return false;
      if (filter === "dreams") return wish.isDream;
      if (filter.startsWith("cat:")) return wish.category === filter.slice(4);
      return true;
    });

    const byNewest = (a: OwnerWish, b: OwnerWish) =>
      b.createdAt.getTime() - a.createdAt.getTime();

    return [...filtered].sort((a, b) => {
      if (sort === "priority") {
        const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        return rank !== 0 ? rank : byNewest(a, b);
      }
      if (sort === "price") {
        // Biggest ticket first, ledger-style; wishes with no price sink last.
        const left = priceValue(a);
        const right = priceValue(b);
        if (left === null && right === null) return byNewest(a, b);
        if (left === null) return 1;
        if (right === null) return -1;
        return right - left || byNewest(a, b);
      }
      return byNewest(a, b);
    });
  }, [wishes, filter, query, sort]);

  function resetFilters() {
    setFilter("all");
    setQuery("");
    setSearchOpen(false);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-105 flex-col px-5 pt-14 pb-32">
      <header className="flex items-center gap-3 pb-3 [border-bottom:3px_double_var(--ink)]">
        <SquareAvatar initial={nickname.charAt(0).toUpperCase()} />
        <div className="min-w-0 flex-1">
          <h1
            className="truncate font-serif text-[21px] font-semibold tracking-[-0.01em]"
            style={{ lineHeight: "var(--lead-tight)" }}
          >
            {t("list.title")}
          </h1>
          <p className="mt-px truncate font-mono text-[10px] tracking-[0.08em] text-mute uppercase">
            {t("home.wishesCount", { count: wishes.length })} · /u/{nickname}
          </p>
        </div>
        <div className="flex flex-none gap-1.5">
          <button
            type="button"
            aria-label={t("list.searchPlaceholder")}
            aria-expanded={searchOpen}
            onClick={() => setSearchOpen((open) => !open)}
            className="flex h-11 w-11 items-center justify-center border border-rule-2 bg-paper text-mute"
          >
            <Search aria-hidden size={16} strokeWidth={2.4} />
          </button>
          <Link
            href="/archive"
            aria-label={t("list.archive")}
            className="flex h-11 w-11 items-center justify-center border border-rule-2 bg-paper text-mute"
          >
            <Archive aria-hidden size={16} strokeWidth={2.4} />
          </Link>
          <button
            type="button"
            aria-label={t("list.share")}
            onClick={() => setShareOpen(true)}
            className="flex h-11 w-11 items-center justify-center border border-rule-2 bg-paper text-mute"
          >
            <Share2 aria-hidden size={16} strokeWidth={2.4} />
          </button>
        </div>
      </header>

      {searchOpen && (
        <Field
          autoFocus
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("list.searchPlaceholder")}
          aria-label={t("list.searchPlaceholder")}
          className="mt-3"
        />
      )}

      {offline && (
        <AlertBanner tone="warning" className="mt-3">
          {t("list.offline")}
        </AlertBanner>
      )}

      {wishes.length > 0 && (
        <div className="flex flex-col gap-2.5 pt-3">
          <div className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-0.5">
            <FilterChip
              selected={filter === "all"}
              onClick={() => setFilter("all")}
              className="flex-none"
            >
              {t("list.filterAll")}
              <span className="font-mono text-[9.5px] opacity-70">
                {wishes.length}
              </span>
            </FilterChip>
            <FilterChip
              selected={filter === "dreams"}
              onClick={() => setFilter("dreams")}
              className="flex-none"
            >
              {t("list.filterDreams")}
            </FilterChip>
            {categories.map((key) => (
              <FilterChip
                key={key}
                selected={filter === `cat:${key}`}
                onClick={() => setFilter(`cat:${key}`)}
                className="flex-none"
              >
                {t(`wish.category.${key}`)}
              </FilterChip>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2">
            <select
              value={sort}
              aria-label={t("list.sortLabel")}
              onChange={(event) => setSort(event.target.value as SortKey)}
              className="min-h-11 min-w-0 flex-1 border border-rule-2 bg-paper px-2.5 text-[12px] text-mute"
            >
              <option value="newest">{t("list.sortNewest")}</option>
              <option value="priority">{t("list.sortPriority")}</option>
              <option value="price">{t("list.sortPrice")}</option>
            </select>
            <Tabs
              className="flex-none"
              value={view}
              onChange={(value) => setView(value as ViewKey)}
              items={[
                { value: "cards", label: t("list.viewCards") },
                { value: "ledger", label: t("list.viewLedger") },
              ]}
            />
          </div>
        </div>
      )}

      {wishes.length === 0 ? (
        <EmptyList />
      ) : visible.length === 0 ? (
        <section className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
          <p className="font-serif text-[17px] font-semibold">
            {t("list.filteredEmpty")}
          </p>
          <Button onClick={resetFilters}>{t("list.resetFilters")}</Button>
        </section>
      ) : view === "cards" ? (
        <div className="grid grid-cols-2 gap-3.5 pt-3.5">
          {visible.map((wish) => (
            <WishCard
              key={wish.id}
              role="owner"
              /* WishCard prints `category` verbatim in the no-photo
                 placeholder, so it gets the label, not the stored key. */
              wish={{
                ...toBaseWish(wish),
                category: wish.category
                  ? t(`wish.category.${wish.category}`)
                  : null,
              }}
              restrictedVisibility={wish.visibility === "restricted"}
              onClick={() => router.push(`/wishes/${wish.id}`)}
              onRetryImage={() => handleRetryImage(wish.id)}
              onUploadImage={() => handleUploadImage(wish.id)}
            />
          ))}
        </div>
      ) : (
        <LedgerView
          wishes={visible}
          onOpen={(id) => router.push(`/wishes/${id}`)}
        />
      )}

      <Fab
        ariaLabel={t("list.addWish")}
        onClick={() => setAddSheetOpen(true)}
      />

      <AddWishSheet
        open={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        ai={ai}
      />

      <ShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        url={`${APP_URL}/u/${nickname}`}
        kind="list"
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void handleFileSelected(file);
        }}
      />

      {generatingIds.length > 0 && (
        <WishImagePoller
          wishIds={generatingIds}
          onSettled={handleImageSettled}
        />
      )}

      <InfoToast
        open={imageReadyToast}
        message={t("ai.imageReady")}
        onDismiss={() => setImageReadyToast(false)}
      />

      <TabBar
        items={[
          { key: "list", label: t("tabs.list"), icon: List, href: "/" },
          {
            key: "people",
            label: t("tabs.people"),
            icon: Users,
            href: "/people",
          },
          {
            key: "profile",
            label: t("tabs.profile"),
            icon: User,
            href: "/profile",
          },
        ]}
      />
    </main>
  );
}

function EmptyList() {
  const t = useTranslations("list");
  const router = useRouter();
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <p className="font-serif text-[19px] font-semibold">{t("emptyTitle")}</p>
      <p className="max-w-72 text-mute">{t("emptyBody")}</p>
      <Button variant="primary" onClick={() => router.push("/wishes/new")}>
        {t("emptyCta")}
      </Button>
    </section>
  );
}

/** Directions 3b: a numbered ledger sheet closed by a double-rule total. */
function LedgerView({
  wishes,
  onOpen,
}: {
  wishes: OwnerWish[];
  onOpen: (id: string) => void;
}) {
  const t = useTranslations();

  return (
    <div className="mt-3.5 border border-rule-2 bg-paper shadow-[var(--shadow-line)]">
      {wishes.map((wish, index) => {
        const price = formatPrice(wish);
        return (
          <button
            key={wish.id}
            type="button"
            onClick={() => onOpen(wish.id)}
            className={`flex w-full items-center gap-2.5 border-b border-dashed border-rule-2 px-3.5 py-2.5 text-left ${
              index % 2 === 1 ? "bg-zebra" : ""
            }`}
          >
            <span className="w-4 flex-none text-right font-mono text-[10px] text-mute-2">
              {index + 1}
            </span>

            <span className="relative h-11 w-11 flex-none overflow-hidden">
              {wish.imageStatus === "ready" && wish.imageKey ? (
                /* eslint-disable-next-line @next/next/no-img-element -- images
                   live on our own storage; no next/image loader is configured. */
                <img
                  src={wish.imageKey}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className="block h-full w-full"
                  style={{ background: PLACEHOLDER_STRIPES }}
                />
              )}
              {wish.visibility === "restricted" && (
                <VisibilityLockBadge
                  label={t("wish.restrictedVisibility")}
                  className="absolute right-0 bottom-0 h-4 w-4"
                />
              )}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate font-serif text-[14px] leading-[1.2] font-semibold">
                {wish.title}
              </span>
              <span className="mt-[3px] flex items-center gap-1.5 text-[10.5px] text-mute">
                <PriorityFlag
                  size="sm"
                  priority={wish.priority}
                  label={t(`wish.priority.${wish.priority}`)}
                />
                {wish.category && (
                  <span className="truncate text-mute-2">
                    · {t(`wish.category.${wish.category}`)}
                  </span>
                )}
                {wish.isDream && (
                  <span className="flex-none font-mono text-[9px] tracking-[var(--track-badge)] text-null-txt uppercase">
                    {t("wish.dream")}
                  </span>
                )}
              </span>
            </span>

            {price ? (
              <span className="flex-none text-right font-mono text-[12px] font-medium whitespace-nowrap">
                {price}
              </span>
            ) : (
              <NullPill
                size="sm"
                label={t("wish.noPrice")}
                className="flex-none"
              />
            )}
          </button>
        );
      })}

      <div className="flex items-center justify-between border-t border-ink px-3.5 py-2.5 [border-bottom:3px_double_var(--ink)]">
        <span className="text-[10px] font-semibold tracking-[0.08em] text-mute uppercase">
          {t("list.totalRow")}
        </span>
        <span className="font-mono text-[15px] font-semibold">
          {wishes.length}
        </span>
      </div>
    </div>
  );
}
