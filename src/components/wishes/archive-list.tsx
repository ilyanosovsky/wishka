"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Dialog } from "@/components/ui/dialog";
import { InfoToast } from "@/components/ui/toast";
import { WishCard } from "@/components/ui/wish-card";
import { destroyWishAction, restoreWishAction } from "@/app/wishes/actions";
import type { OwnerWish } from "@/db/access/types";
import { toBaseWish } from "./wish-card-props";

export type ArchiveListProps = {
  wishes: OwnerWish[];
};

type YearGroup = { year: number | null; wishes: OwnerWish[] };

/** Newest year first, wishes with no `giftedAt` (edge case — should not
 *  normally happen once markGifted always stamps a date) grouped last. */
function groupByYear(wishes: OwnerWish[]): YearGroup[] {
  const byYear = new Map<number | null, OwnerWish[]>();
  for (const wish of wishes) {
    const year = wish.giftedAt ? wish.giftedAt.getFullYear() : null;
    const list = byYear.get(year) ?? [];
    list.push(wish);
    byYear.set(year, list);
  }

  const groups = [...byYear.entries()].map(([year, list]) => ({
    year,
    wishes: [...list].sort(
      (a, b) => (b.giftedAt?.getTime() ?? 0) - (a.giftedAt?.getTime() ?? 0),
    ),
  }));

  groups.sort((a, b) => {
    if (a.year === null) return 1;
    if (b.year === null) return -1;
    return b.year - a.year;
  });
  return groups;
}

/** §6.9 archive: year-grouped grid, tap for restore / permanent delete. */
export function ArchiveList({ wishes }: ArchiveListProps) {
  const t = useTranslations();
  const router = useRouter();

  const [selected, setSelected] = useState<OwnerWish | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState(false);

  const groups = useMemo(() => groupByYear(wishes), [wishes]);

  async function handleRestore() {
    if (!selected) return;
    setRestoring(true);
    const result = await restoreWishAction(selected.id);
    setRestoring(false);
    if (result.ok) {
      setSelected(null);
      router.refresh();
    } else {
      setActionError(true);
    }
  }

  async function handleDeleteForever() {
    if (!selected || deleting) return;
    setDeleting(true);
    const result = await destroyWishAction(selected.id);
    setDeleting(false);
    if (result.ok) {
      setConfirmDeleteOpen(false);
      setSelected(null);
      router.refresh();
    } else {
      setActionError(true);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-105 flex-col gap-5 px-5 pt-14 pb-10">
      <header className="flex items-center gap-3 border-b-2 border-ink pb-4">
        <Link
          href="/"
          aria-label={t("common.back")}
          className="flex h-10 w-10 flex-none items-center justify-center border border-rule-2 bg-paper"
        >
          <ChevronLeft aria-hidden size={16} strokeWidth={2.2} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1
            className="truncate font-serif text-[21px] font-semibold tracking-[-0.01em]"
            style={{ lineHeight: "var(--lead-tight)" }}
          >
            {t("archive.title")}
          </h1>
          <p className="mt-0.5 truncate font-mono text-[10px] tracking-[0.08em] text-mute uppercase">
            {t("archive.countLabel", { count: wishes.length })}
          </p>
        </div>
      </header>

      {groups.length === 0 ? (
        <section className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
          <p className="text-mute">{t("archive.empty")}</p>
        </section>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <section
              key={group.year ?? "unknown"}
              className="flex flex-col gap-3"
            >
              <h2 className="font-mono text-[10px] tracking-[0.14em] text-mute-2">
                — {group.year ?? "—"} —
              </h2>
              <div className="grid grid-cols-2 gap-3">
                {group.wishes.map((wish) => (
                  <WishCard
                    key={wish.id}
                    role="archive"
                    wish={{
                      ...toBaseWish(wish),
                      /* label, not the stored key — same as my-list */
                      category: wish.category
                        ? t(`wish.category.${wish.category}`)
                        : null,
                    }}
                    giftedAt={
                      wish.giftedAt ? wish.giftedAt.toISOString() : null
                    }
                    giftedBy={wish.giftedBy}
                    onClick={() => setSelected(wish)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <BottomSheet
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.title}
      >
        <div className="flex flex-col">
          <button
            type="button"
            onClick={() => void handleRestore()}
            disabled={restoring}
            className="min-h-11 cursor-pointer border-t border-rule py-3 text-left text-[13px] font-medium first:border-t-0 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t("archive.restore")}
          </button>
          <button
            type="button"
            onClick={() => setConfirmDeleteOpen(true)}
            className="min-h-11 cursor-pointer border-t border-rule py-3 text-left text-[13px] font-semibold text-neg"
          >
            {t("archive.deleteForever")}
          </button>
        </div>
      </BottomSheet>

      <Dialog
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        title={t("archive.confirmTitle")}
        description={t("archive.confirmDesc")}
        actions={[
          {
            label: t("common.cancel"),
            onClick: () => setConfirmDeleteOpen(false),
            tone: "neutral",
          },
          {
            label: t("common.delete"),
            onClick: () => void handleDeleteForever(),
            tone: "destructive",
          },
        ]}
      />

      <InfoToast
        open={actionError}
        message={t("common.actionFailed")}
        onDismiss={() => setActionError(false)}
      />
    </main>
  );
}
