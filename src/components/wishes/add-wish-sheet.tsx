"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { AlertBanner } from "@/components/ui/banner";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { SkeletonWishCard } from "@/components/ui/skeleton";
import {
  parseUrlAction,
  type ParseOutcome,
  type ParseUrlResult,
} from "@/app/wishes/parse-actions";

/**
 * §6.3 steps 1–2 — the FAB's entry sheet: paste a link, watch it parse, land
 * on the step-3 form either pre-filled or manual. Stays mounted while closed
 * (BottomSheet's own contract) so its exit transition can play; every piece
 * of local state is reset on close (see the `wasOpen` render-time check and
 * the effect right below it), so reopening the sheet always starts clean.
 */

const PARSED_STORAGE_KEY = "wishka-parsed-wish";
const SLOW_PARSE_MS = 5000;

type Phase = "idle" | "parsing" | "blocked" | "duplicate";

type BlockedOutcome = Extract<ParseOutcome, { status: "manual" }>;
type OkOutcome = Extract<ParseOutcome, { status: "ok" | "partial" }>;

export type AddWishSheetProps = {
  open: boolean;
  onClose: () => void;
};

function manualHref(url: string): string {
  return `/wishes/new?url=${encodeURIComponent(url)}`;
}

export function AddWishSheet({ open, onClose }: AddWishSheetProps) {
  const t = useTranslations();
  const router = useRouter();
  const urlFieldId = useId();

  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [slow, setSlow] = useState(false);
  const [duplicate, setDuplicate] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [blockedOutcome, setBlockedOutcome] = useState<BlockedOutcome | null>(
    null,
  );

  // Guards against a parse result landing after the user has already bailed
  // to the manual form (via "Заполнить руками") or the sheet has been closed
  // and reopened — bumped on either event, checked when the promise resolves.
  const generationRef = useRef(0);
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The outcome set aside while the duplicate block is showing, so
  // "Всё равно добавить" can resume exactly where the duplicate check
  // interrupted it.
  const pendingOutcomeRef = useRef<ParseUrlResult | null>(null);

  function clearSlowTimer() {
    if (slowTimerRef.current) {
      clearTimeout(slowTimerRef.current);
      slowTimerRef.current = null;
    }
  }

  // Reset for the next open once the sheet has been dismissed — BottomSheet
  // keeps this component mounted through its close transition, so the state
  // has to be cleared explicitly rather than falling out of an unmount.
  //
  // This follows React's "adjust state during render" recipe (comparing a
  // previous-prop snapshot in the render body) instead of a `useEffect`,
  // because calling setState synchronously from inside an effect body causes
  // an extra, avoidable render pass.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setUrl("");
      setUrlError(false);
      setPhase("idle");
      setSlow(false);
      setDuplicate(null);
      setBlockedOutcome(null);
    }
  }

  // The non-React bits (in-flight generation counter, pending timer, the
  // duplicate-resume outcome) belong in an effect: they're refs, not state,
  // so clearing them here carries none of the render-time reset's constraints.
  useEffect(() => {
    if (open) return;
    generationRef.current += 1;
    clearSlowTimer();
    pendingOutcomeRef.current = null;
  }, [open]);

  function writeParsedHandoff(outcome: OkOutcome) {
    try {
      window.sessionStorage.setItem(
        PARSED_STORAGE_KEY,
        JSON.stringify({
          fields: outcome.fields,
          url: outcome.url,
          partial: outcome.status === "partial",
        }),
      );
    } catch {
      // sessionStorage can be unavailable (private mode, quota) — the
      // handoff is a convenience; the new-wish page still works without it.
    }
  }

  function finalizeOutcome(outcome: ParseOutcome) {
    if (outcome.status === "manual") {
      if (outcome.reason === "invalid_url") {
        setUrlError(true);
        setPhase("idle");
        return;
      }
      // stoplist | failed | quota — calm banner, manual form with the url preserved.
      setBlockedOutcome(outcome);
      setPhase("blocked");
      return;
    }
    writeParsedHandoff(outcome);
    router.push("/wishes/new?parsed=1");
  }

  function applyResult(result: ParseUrlResult) {
    if (result.duplicate) {
      pendingOutcomeRef.current = result;
      setDuplicate(result.duplicate);
      setPhase("duplicate");
      return;
    }
    finalizeOutcome(result);
  }

  async function handleParse() {
    const rawUrl = url.trim();
    if (!rawUrl) return;

    setUrlError(false);
    setSlow(false);
    setPhase("parsing");

    generationRef.current += 1;
    const generation = generationRef.current;
    slowTimerRef.current = setTimeout(() => {
      if (generationRef.current === generation) setSlow(true);
    }, SLOW_PARSE_MS);

    const result = await parseUrlAction(rawUrl);

    clearSlowTimer();
    if (generationRef.current !== generation) return; // cancelled or stale

    applyResult(result);
  }

  function handleFillManually() {
    generationRef.current += 1; // any late result from the in-flight parse is now ignored
    clearSlowTimer();
    router.push(manualHref(url.trim()));
  }

  async function handlePasteClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        setUrl(text.trim());
        setUrlError(false);
      }
    } catch {
      // Clipboard permission denied or unsupported — fall through to focus.
    } finally {
      document.getElementById(urlFieldId)?.focus();
    }
  }

  function handleDuplicateOpen() {
    if (duplicate) router.push(`/wishes/${duplicate.id}`);
  }

  function handleDuplicateAnyway() {
    const pending = pendingOutcomeRef.current;
    setDuplicate(null);
    if (pending) finalizeOutcome(pending);
  }

  function handleManualFromBlocked() {
    if (blockedOutcome) router.push(manualHref(blockedOutcome.url));
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={t("parse.sheetTitle")}>
      <div className="flex flex-col gap-4">
        {phase === "idle" && (
          <>
            <TextField
              id={urlFieldId}
              label={t("parse.urlLabel")}
              placeholder={t("parse.urlPlaceholder")}
              inputMode="url"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setUrlError(false);
              }}
              error={urlError}
              helperText={t("parse.urlInvalid")}
            />

            <Button
              type="button"
              variant="ghost"
              className="w-fit px-0"
              onClick={() => void handlePasteClipboard()}
            >
              {t("parse.pasteClipboard")}
            </Button>

            <Button
              type="button"
              variant="primary"
              className="w-full"
              disabled={!url.trim()}
              onClick={() => void handleParse()}
            >
              {t("parse.parseCta")}
            </Button>

            <div className="flex items-center gap-3 text-[11px] text-mute-2">
              <span aria-hidden className="h-px flex-1 bg-rule-2" />
              {t("parse.orManual")}
              <span aria-hidden className="h-px flex-1 bg-rule-2" />
            </div>

            <Button
              type="button"
              className="w-full"
              onClick={() => router.push("/wishes/new")}
            >
              {t("parse.manualCta")}
            </Button>
          </>
        )}

        {phase === "parsing" && (
          <div className="flex flex-col items-center gap-3 py-2">
            <SkeletonWishCard className="w-36" />
            <p className="text-center text-[13px] text-mute">
              {slow ? t("parse.parsingSlow") : t("parse.parsing")}
            </p>
            {slow && (
              <Button
                type="button"
                variant="ghost"
                onClick={handleFillManually}
              >
                {t("parse.fillManually")}
              </Button>
            )}
          </div>
        )}

        {phase === "blocked" && blockedOutcome && (
          <div className="flex flex-col gap-3">
            <AlertBanner tone="warning">
              {blockedOutcome.reason === "quota"
                ? t("parse.quotaExceeded")
                : t("parse.failedTitle")}
            </AlertBanner>
            <Button
              type="button"
              variant="primary"
              className="w-full"
              onClick={handleManualFromBlocked}
            >
              {t("parse.manualCta")}
            </Button>
          </div>
        )}

        {phase === "duplicate" && duplicate && (
          <div className="flex flex-col gap-3">
            <p className="font-serif text-[16px] font-semibold">
              {t("parse.duplicateTitle")}
            </p>
            <p className="text-[14px] text-mute">{duplicate.title}</p>
            <div className="flex gap-2">
              <Button
                type="button"
                className="flex-1"
                onClick={handleDuplicateOpen}
              >
                {t("parse.duplicateOpen")}
              </Button>
              <Button
                type="button"
                variant="primary"
                className="flex-1"
                onClick={handleDuplicateAnyway}
              >
                {t("parse.duplicateAnyway")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
