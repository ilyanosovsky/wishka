"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { clearPartnerAction, setPartnerAction } from "@/app/profile/actions";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { InfoToast } from "@/components/ui/toast";

export type PartnerCandidate = {
  userId: string;
  name: string;
  image: string | null;
};

export type PartnerBlockProps = {
  /** Null when no partner is set. */
  partner: PartnerCandidate | null;
  /** Every member of the owner's groups, deduped — the same list the "Кому
   *  видно" people picker draws from (§6.3). Fetched by the page, not here. */
  candidates: PartnerCandidate[];
};

const SECTION_CLASS =
  "flex flex-col gap-3 border border-rule-2 bg-paper p-4 shadow-[var(--shadow-line)]";
const HEADING_CLASS =
  "font-mono text-[10.5px] font-medium tracking-[0.1em] uppercase text-mute";

/**
 * §6.6 partner block. Picking a candidate *is* the action — no separate save
 * step — so a successful pick confirms with a toast instead of leaving a
 * pending draft on screen.
 */
export function PartnerBlock({ partner, candidates }: PartnerBlockProps) {
  const t = useTranslations();
  const router = useRouter();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      candidates.filter(
        (c) =>
          !normalizedQuery || c.name.toLowerCase().includes(normalizedQuery),
      ),
    [candidates, normalizedQuery],
  );

  async function pick(candidateId: string) {
    setSaving(true);
    try {
      const result = await setPartnerAction(candidateId);
      setSaving(false);
      if (result.ok) {
        setPickerOpen(false);
        setQuery("");
        setSaved(true);
        router.refresh();
      } else {
        setFailed(true);
      }
    } catch {
      setSaving(false);
      setFailed(true);
    }
  }

  async function remove() {
    setSaving(true);
    try {
      const result = await clearPartnerAction();
      setSaving(false);
      if (result.ok) {
        router.refresh();
      } else {
        setFailed(true);
      }
    } catch {
      setSaving(false);
      setFailed(true);
    }
  }

  return (
    <section className={SECTION_CLASS}>
      <h2 className={HEADING_CLASS}>{t("partner.title")}</h2>

      {partner ? (
        <div className="flex items-center gap-3">
          <Avatar size="md" name={partner.name} src={partner.image} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
            {partner.name}
          </span>
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() => void remove()}
          >
            {t("partner.remove")}
          </Button>
        </div>
      ) : candidates.length === 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-[12.5px] text-mute">{t("partner.empty")}</p>
          <a
            href="/people"
            className="text-[12.5px] font-semibold text-accent underline"
          >
            {t("partner.emptyCta")}
          </a>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <p className="text-[12px] text-mute">{t("partner.hint")}</p>
          <Button onClick={() => setPickerOpen(true)}>
            {t("partner.add")}
          </Button>
        </div>
      )}

      <BottomSheet
        open={pickerOpen}
        onClose={() => {
          if (saving) return;
          setPickerOpen(false);
          setQuery("");
        }}
        title={t("partner.pickTitle")}
      >
        <div className="flex flex-col gap-1 pb-2">
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
          <div className="flex flex-col">
            {filtered.map((candidate) => (
              <button
                key={candidate.userId}
                type="button"
                disabled={saving}
                onClick={() => void pick(candidate.userId)}
                className="flex min-h-11 cursor-pointer items-center gap-2.5 border-t border-rule text-left text-[13px] first:border-t-0 disabled:cursor-not-allowed"
              >
                <Avatar size="sm" name={candidate.name} src={candidate.image} />
                <span className="min-w-0 flex-1 truncate">
                  {candidate.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      </BottomSheet>

      <InfoToast
        open={saved}
        message={t("partner.saved")}
        onDismiss={() => setSaved(false)}
      />
      <InfoToast
        open={failed}
        message={t("common.actionFailed")}
        onDismiss={() => setFailed(false)}
      />
    </section>
  );
}
