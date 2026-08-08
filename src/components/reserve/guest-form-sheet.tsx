"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  reserveAsGuestAction,
  saveGuestEmailAction,
} from "@/app/reserve/actions";
import { AlertBanner } from "@/components/ui/banner";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";

/**
 * The anonymous visitor's way in (DESIGN_BRIEF §6.4): a name is all we ask,
 * an email only buys the manage-booking link. The booking itself is already
 * done by the time the success state shows — the email prompt is a bonus, and
 * skipping it must cost the guest nothing.
 *
 * The sheet owns only the introduction. Everything that happens to the *wish*
 * (conflict, deletion, the panel's own status) is reported upwards, so there
 * is exactly one place that decides what the screen shows.
 */

type Phase = "form" | "success";

export type GuestFormSheetProps = {
  open: boolean;
  wishId: string;
  /** Dismissed without finishing — the panel just closes the sheet. */
  onClose: () => void;
  /** The booking landed; the panel can flip its status behind the sheet. */
  onReserved: () => void;
  /** Success state acknowledged ("Понятно") — close and re-read the page. */
  onDone: () => void;
  /** Someone else got there first while the form was open. */
  onConflict: () => void;
  /** The owner deleted the wish while the form was open. */
  onGone: () => void;
};

export function GuestFormSheet({
  open,
  wishId,
  onClose,
  onReserved,
  onDone,
  onConflict,
  onGone,
}: GuestFormSheetProps) {
  const t = useTranslations();

  const [phase, setPhase] = useState<Phase>("form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [nameError, setNameError] = useState(false);
  const [emailError, setEmailError] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  /** Only the "no email yet" success state asks for one. */
  const [needsEmail, setNeedsEmail] = useState(false);
  const [emailSaved, setEmailSaved] = useState(false);

  // BottomSheet keeps this mounted through its close transition, so the reset
  // is explicit (same render-time recipe as AddWishSheet) — reopening the
  // sheet must never show the previous guest's name or a stale success state.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setPhase("form");
      setName("");
      setEmail("");
      setNameError(false);
      setEmailError(false);
      setFailed(false);
      setPending(false);
      setNeedsEmail(false);
      setEmailSaved(false);
    }
  }

  async function handleSubmit() {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    // The one check worth doing before the round trip: without a name there is
    // nothing to remember the booking by.
    if (!trimmedName) {
      setNameError(true);
      return;
    }

    setNameError(false);
    setEmailError(false);
    setFailed(false);
    setPending(true);

    try {
      const result = await reserveAsGuestAction(wishId, {
        name: trimmedName,
        email: trimmedEmail || null,
      });

      if (result.ok) {
        onReserved();
        setNeedsEmail(!result.hasEmail);
        setPhase("success");
        return;
      }

      if (result.reason === "invalid_name") setNameError(true);
      else if (result.reason === "invalid_email") setEmailError(true);
      else if (result.reason === "already_reserved") onConflict();
      else onGone();
    } catch {
      // Network error, crashed action, session redirect — never a dead spinner.
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  async function handleSaveEmail() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setEmailError(true);
      return;
    }

    setEmailError(false);
    setFailed(false);
    setPending(true);

    try {
      const result = await saveGuestEmailAction(wishId, trimmedEmail);
      if (result.ok) {
        setEmailSaved(true);
        return;
      }
      if (result.reason === "invalid_email") setEmailError(true);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={
        phase === "form"
          ? t("reserve.guestFormTitle")
          : t("reserve.successTitle")
      }
    >
      <div className="flex flex-col gap-4">
        {failed && (
          <AlertBanner tone="error">{t("common.actionFailed")}</AlertBanner>
        )}

        {phase === "form" ? (
          <>
            <TextField
              label={t("reserve.guestNameLabel")}
              value={name}
              autoComplete="name"
              onChange={(event) => {
                setName(event.target.value);
                setNameError(false);
              }}
              error={nameError}
              helperText={t("reserve.guestNameRequired")}
            />

            <div className="flex flex-col gap-1.5">
              <TextField
                label={t("reserve.guestEmailLabel")}
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setEmailError(false);
                }}
                error={emailError}
                helperText={t("reserve.guestEmailInvalid")}
              />
              {!emailError && (
                <p className="text-[11px] text-mute-2">
                  {t("reserve.guestEmailHint")}
                </p>
              )}
            </div>

            <Button
              variant="primary"
              className="w-full"
              loading={pending}
              onClick={() => void handleSubmit()}
            >
              {t("reserve.guestSubmit")}
            </Button>
          </>
        ) : (
          <>
            <p className="text-[13px] text-mute">{t("reserve.successBody")}</p>

            {needsEmail &&
              (emailSaved ? (
                <p className="text-[13px] text-accent">
                  {t("reserve.successEmailSaved")}
                </p>
              ) : (
                <div className="flex flex-col gap-2.5 border-t border-rule pt-3.5">
                  <p className="text-[13px] text-mute">
                    {t("reserve.successEmailPrompt")}
                  </p>
                  <TextField
                    label={t("reserve.successEmailLabel")}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      setEmailError(false);
                    }}
                    error={emailError}
                    helperText={t("reserve.guestEmailInvalid")}
                  />
                  <Button
                    className="w-full"
                    loading={pending}
                    onClick={() => void handleSaveEmail()}
                  >
                    {t("reserve.successEmailSave")}
                  </Button>
                </div>
              ))}

            <Button variant="primary" className="w-full" onClick={onDone}>
              {t("reserve.successDone")}
            </Button>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
