"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { AlertBanner } from "@/components/ui/banner";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { TextareaField, TextField } from "@/components/ui/field";
import { SkeletonWishCard } from "@/components/ui/skeleton";
import {
  parseUrlAction,
  type ParseOutcome,
  type ParseUrlResult,
} from "@/app/wishes/parse-actions";
import {
  draftWishFromTextAction,
  type WishDraft,
} from "@/app/wishes/ai-actions";
import type { AiQuotaSnapshot } from "@/lib/ai/types";

/**
 * §6.3 steps 1–2 — the FAB's entry sheet: paste a link, watch it parse, land
 * on the step-3 form either pre-filled or manual. Stays mounted while closed
 * (BottomSheet's own contract) so its exit transition can play; every piece
 * of local state is reset on close (see the `wasOpen` render-time check and
 * the effect right below it), so reopening the sheet always starts clean.
 *
 * The "words" phase (§6.3 AI addendum) is the third entry path: free text →
 * `draftWishFromTextAction` → a `wishka-ai-draft` sessionStorage handoff read
 * by `/wishes/new?ai=1`, mirroring the parsed-link handoff exactly.
 */

const PARSED_STORAGE_KEY = "wishka-parsed-wish";
const AI_DRAFT_STORAGE_KEY = "wishka-ai-draft";
const SLOW_PARSE_MS = 5000;

type Phase = "idle" | "parsing" | "blocked" | "duplicate" | "words";
type WordsBlockReason = "quota" | "unavailable" | "failed";

type BlockedOutcome = Extract<ParseOutcome, { status: "manual" }>;
type OkOutcome = Extract<ParseOutcome, { status: "ok" | "partial" }>;

export type AddWishSheetProps = {
  open: boolean;
  onClose: () => void;
  /** Server-computed AI availability + daily quota snapshot (see
   *  `isAiAvailable`/`getAiQuotaRemaining`). Undefined hides the "Добавь
   *  словами" entry entirely — no AI affordance is ever offered without it. */
  ai?: AiQuotaSnapshot;
};

function manualHref(url: string): string {
  return `/wishes/new?url=${encodeURIComponent(url)}`;
}

/** A host-looking string with no whitespace — mirrors `BARE_HOST_RE` in
 *  `src/lib/parse/normalize.ts`, which accepts "shop.com/x" pasted without a
 *  scheme. That module imports `node:crypto`, so it cannot be reused here. */
const BARE_HOST_RE = /^[\w-]+(\.[\w-]+)+(?=$|[/?#])/;

/**
 * §6.3 only offers the clipboard when it holds a *link*. The permanent button
 * stays (a proactive `clipboard.readText()` costs a permission prompt in
 * Chromium — deviation recorded in IMPLEMENTATION_PLAN), but what it pastes is
 * now checked the same way the server's `normalizeUrl` checks it: anything
 * that is not an http(s) page shows the invalid-link state instead of dropping
 * junk into the field.
 */
function looksLikeUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    if (!BARE_HOST_RE.test(trimmed)) return false;
    try {
      url = new URL(`https://${trimmed}`);
    } catch {
      return false;
    }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return Boolean(url.hostname) && url.hostname.includes(".");
}

export function AddWishSheet({ open, onClose, ai }: AddWishSheetProps) {
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

  const [wordsText, setWordsText] = useState("");
  const [wordsBusy, setWordsBusy] = useState(false);
  const [wordsBlockReason, setWordsBlockReason] =
    useState<WordsBlockReason | null>(null);
  // The server-issued snapshot is a starting point only — every draft result
  // carries its own `remaining`, which is what actually keeps this in sync
  // (the UI counter is advisory, per invariant #4; the server always re-checks).
  const [textRemaining, setTextRemaining] = useState(ai?.text ?? 0);

  // Guards against a parse result landing after the user has already bailed
  // to the manual form (via "Заполнить вручную") or the sheet has been closed
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
      setWordsText("");
      setWordsBusy(false);
      setWordsBlockReason(null);
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

  /** Returns false when the handoff couldn't be stored (private mode, quota),
   *  so the caller can fall back to a URL-carrying manual link instead of
   *  navigating to an empty parsed form. */
  function writeParsedHandoff(outcome: OkOutcome): boolean {
    try {
      window.sessionStorage.setItem(
        PARSED_STORAGE_KEY,
        JSON.stringify({
          fields: outcome.fields,
          url: outcome.url,
          partial: outcome.status === "partial",
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  /** Same one-shot handoff contract as `writeParsedHandoff`, one key over. */
  function writeAiDraftHandoff(draft: WishDraft): boolean {
    try {
      window.sessionStorage.setItem(
        AI_DRAFT_STORAGE_KEY,
        JSON.stringify({ draft }),
      );
      return true;
    } catch {
      return false;
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
    // If the handoff can't be persisted, keep at least the URL so the manual
    // form isn't blank.
    router.push(
      writeParsedHandoff(outcome)
        ? "/wishes/new?parsed=1"
        : manualHref(outcome.url),
    );
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

    let result: ParseUrlResult;
    try {
      result = await parseUrlAction(rawUrl);
    } catch {
      // Network error / server crash / session redirect rejection — degrade to
      // the calm manual path with the URL preserved, never a dead spinner.
      clearSlowTimer();
      if (generationRef.current !== generation) return;
      setBlockedOutcome({ status: "manual", reason: "failed", url: rawUrl });
      setPhase("blocked");
      return;
    }

    clearSlowTimer();
    if (generationRef.current !== generation) return; // cancelled or stale

    applyResult(result);
  }

  function handleFillManually() {
    generationRef.current += 1; // any late result from the in-flight parse is now ignored
    clearSlowTimer();
    router.push(manualHref(url.trim()));
  }

  async function handleDraftWords() {
    const text = wordsText.trim();
    if (!text) return;

    setWordsBlockReason(null);
    setWordsBusy(true);

    generationRef.current += 1;
    const generation = generationRef.current;

    let result: Awaited<ReturnType<typeof draftWishFromTextAction>>;
    try {
      result = await draftWishFromTextAction(text);
    } catch {
      if (generationRef.current !== generation) return;
      setWordsBusy(false);
      setWordsBlockReason("failed");
      return;
    }

    if (generationRef.current !== generation) return; // sheet closed/reopened meanwhile
    setWordsBusy(false);

    if (typeof result.remaining === "number")
      setTextRemaining(result.remaining);

    if (result.ok) {
      // Same fallback as the parsed-link handoff: if storage can't be
      // written, land on the blank manual form rather than a dead spinner.
      router.push(
        writeAiDraftHandoff(result.value) ? "/wishes/new?ai=1" : "/wishes/new",
      );
      return;
    }

    setWordsBlockReason(result.reason === "error" ? "failed" : result.reason);
  }

  async function handlePasteClipboard() {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) return; // empty clipboard: nothing to say, just focus the field
      if (looksLikeUrl(text)) {
        setUrl(text);
        setUrlError(false);
      } else {
        // Not a link — say so on the field rather than pasting junk into it.
        setUrlError(true);
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

            {/* §6.3 lists "Добавь словами" as the second of three equal
                entry options — it sits above the "или вручную" divider so
                it reads as a peer of the link entry, not a subordinate
                fourth item under manual entry. */}
            {ai !== undefined && (
              <>
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => setPhase("words")}
                >
                  {t("ai.entryCta")}
                </Button>
                <p className="text-center text-[11px] text-mute-2">
                  {t("ai.entryHint")}
                </p>
              </>
            )}

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

        {phase === "words" && (
          <div className="flex flex-col gap-4">
            <TextareaField
              label={t("ai.textLabel")}
              placeholder={t("ai.textPlaceholder")}
              value={wordsText}
              onChange={(event) => {
                setWordsText(event.target.value);
                setWordsBlockReason(null);
              }}
              rows={4}
            />

            {wordsBlockReason && (
              <AlertBanner tone="warning">
                {wordsBlockReason === "quota"
                  ? t("ai.textQuotaExhausted")
                  : wordsBlockReason === "unavailable"
                    ? t("ai.unavailable")
                    : t("ai.draftFailed")}
              </AlertBanner>
            )}

            <Button
              type="button"
              variant="primary"
              className="w-full"
              loading={wordsBusy}
              disabled={wordsBusy || !wordsText.trim()}
              onClick={() => void handleDraftWords()}
            >
              {wordsBusy ? t("ai.drafting") : t("ai.draftCta")}
            </Button>

            <p className="text-center text-[11px] text-mute-2">
              {t("ai.textQuotaLeft", { count: textRemaining })}
            </p>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                className="flex-1"
                onClick={() => setPhase("idle")}
              >
                {t("common.back")}
              </Button>
              {wordsBlockReason === "failed" && (
                <Button
                  type="button"
                  className="flex-1"
                  onClick={() => void handleDraftWords()}
                >
                  {t("ai.tryAgain")}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                className="flex-1"
                onClick={() => router.push("/wishes/new")}
              >
                {t("parse.manualCta")}
              </Button>
            </div>
          </div>
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
