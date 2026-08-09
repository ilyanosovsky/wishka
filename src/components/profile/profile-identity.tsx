"use client";

import { Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import {
  checkNicknameAction,
  updateNameAction,
  updateNicknameAction,
} from "@/app/profile/actions";
import type { NicknameCheck } from "@/app/welcome/actions";
import { Avatar } from "@/components/ui/avatar";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { InfoToast } from "@/components/ui/toast";
import { downscaleToSquare } from "@/lib/image";
import { NICKNAME_RE } from "@/lib/nickname";
import { useUploadThing } from "@/lib/uploadthing-client";

/**
 * §6.6 identity header — avatar, name and nickname are all editable here;
 * before Phase 9 they were frozen at onboarding and `/welcome` redirects away
 * once a profile exists, so a user who tapped «Пропустить» was stuck forever.
 *
 * The avatar path is the onboarding one (`useUploadThing("avatar")` +
 * `downscaleToSquare`): the upload route writes `user.image` server-side, so
 * the URL here is only a local preview until `router.refresh()` lands.
 */

type NicknameState = NicknameCheck | "checking" | "idle";
type AvatarError = "upload" | "tooLarge" | "notImage" | null;

/** The uploaded file is a ≤512px webp, so this only guards the *source* the
 *  browser has to decode — a 50MP RAW export would hang `createImageBitmap`. */
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const NAME_MAX_LENGTH = 80;

export type ProfileIdentityProps = {
  name: string;
  image: string | null;
  nickname: string;
  /** `NEXT_PUBLIC_APP_URL`, resolved by the page — never a hardcoded domain,
   *  or preview deploys advertise a link that points somewhere else. */
  appUrl: string;
};

export function ProfileIdentity({
  name,
  image,
  nickname,
  appUrl,
}: ProfileIdentityProps) {
  const t = useTranslations();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { startUpload } = useUploadThing("avatar");

  const [avatarUrl, setAvatarUrl] = useState<string | null>(image);
  const [uploading, setUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<AvatarError>(null);

  const [nameDraft, setNameDraft] = useState(name);
  const [savingName, setSavingName] = useState(false);

  const [nickOpen, setNickOpen] = useState(false);
  const [nickDraft, setNickDraft] = useState(nickname);
  const [nickCheck, setNickCheck] = useState<{
    value: string;
    result: NicknameCheck;
  } | null>(null);
  const [savingNick, setSavingNick] = useState(false);

  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);

  const publicUrl = `${appUrl.replace(/\/+$/, "")}/u/${nickname}`;
  // The visible line drops the scheme — it is a label, not a link to parse.
  const publicLabel = publicUrl.replace(/^https?:\/\//, "");

  const nickValue = nickDraft.trim().toLowerCase();
  const nickDirty = nickValue !== nickname;
  // The user's own current nickname is never "taken" by someone else, so it
  // short-circuits the probe — it just isn't a change worth saving.
  const nickState: NicknameState = !nickValue
    ? "idle"
    : !NICKNAME_RE.test(nickValue)
      ? "invalid"
      : !nickDirty
        ? "free"
        : nickCheck?.value === nickValue
          ? nickCheck.result
          : "checking";

  /**
   * Generation counter for the availability probe — the same guard
   * `add-wish-sheet.tsx` uses for `parseUrlAction`.
   *
   * Debouncing cancels the *timer*, not an already-issued request, so two
   * probes can overlap whenever a value settles for 400 ms while the previous
   * one is still open. Whichever resolved last used to win `setNickCheck`, and
   * if that was the older value then `nickCheck.value !== nickValue` forever ⇒
   * `nickState` stuck at "checking" ⇒ Save greyed out on a perfectly free
   * nickname, with no further probe scheduled to break the deadlock. Only the
   * newest probe may answer.
   */
  const nickProbeRef = useRef(0);

  // Debounced availability probe — same shape as the onboarding form's.
  useEffect(() => {
    if (!nickOpen) return;
    const value = nickDraft.trim().toLowerCase();
    if (!value || !NICKNAME_RE.test(value) || value === nickname) return;
    const timer = setTimeout(async () => {
      nickProbeRef.current += 1;
      const generation = nickProbeRef.current;
      const result = await checkNicknameAction(value);
      if (nickProbeRef.current !== generation) return; // a newer probe owns the answer
      setNickCheck({ value, result });
    }, 400);
    return () => clearTimeout(timer);
  }, [nickDraft, nickOpen, nickname]);

  function openNickSheet() {
    // Any probe still in flight belongs to the previous opening of the sheet.
    nickProbeRef.current += 1;
    setNickDraft(nickname);
    setNickCheck(null);
    setNickOpen(true);
  }

  async function onAvatarPick(file: File | undefined) {
    if (!file) return;
    setAvatarError(null);
    if (!file.type.startsWith("image/")) {
      setAvatarError("notImage");
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setAvatarError("tooLarge");
      return;
    }
    setUploading(true);
    try {
      const small = await downscaleToSquare(file);
      const uploaded = await startUpload([small]);
      const url = uploaded?.[0]?.ufsUrl;
      if (!url) throw new Error("upload failed");
      setAvatarUrl(url);
      router.refresh();
    } catch {
      setAvatarError("upload");
    } finally {
      setUploading(false);
      // Let the same file be re-picked after a failure.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function saveName() {
    setSavingName(true);
    try {
      const result = await updateNameAction(nameDraft);
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setSavingName(false);
    }
  }

  async function saveNickname() {
    setSavingNick(true);
    try {
      const result = await updateNicknameAction(nickValue);
      if (result.ok) {
        setNickOpen(false);
        setSaved(true);
        router.refresh();
      } else if (result.error === "taken") {
        setNickCheck({ value: nickValue, result: "taken" });
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setSavingNick(false);
    }
  }

  async function copyPublicUrl() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
    } catch {
      // Clipboard access can be denied (insecure context, permissions) — the
      // link is on screen to copy by hand, so fail quietly.
    }
  }

  const avatarErrorText =
    avatarError === "tooLarge"
      ? t("form.photoTooLarge")
      : avatarError === "notImage"
        ? t("form.photoNotImage")
        : avatarError === "upload"
          ? t("auth.onboarding.avatarError")
          : null;

  const nameDirty = nameDraft.trim() !== name && nameDraft.trim().length > 0;

  return (
    <header className="flex flex-col gap-3 border-b-2 border-ink pb-5">
      <div className="flex items-center gap-4">
        <Avatar size="lg" name={name} alt={name} src={avatarUrl} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate font-serif text-[24px] font-semibold tracking-[-0.01em]">
            {name}
          </h1>
          {/* A real <button> firing the input via ref, not a <label> wrapping
              a display:none input — labels are not in the tab order (a11y). */}
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex min-h-11 w-fit cursor-pointer items-center text-[12px] font-medium text-accent underline underline-offset-2 disabled:cursor-not-allowed disabled:text-mute"
          >
            {uploading
              ? t("auth.onboarding.avatarUploading")
              : t("profile.avatarChange")}
          </button>
          {avatarErrorText && (
            <span className="text-[11px] text-neg">{avatarErrorText}</span>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={uploading}
            onChange={(event) => void onAvatarPick(event.target.files?.[0])}
          />
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={openNickSheet}
          className="inline-flex min-h-11 min-w-0 flex-1 cursor-pointer items-center truncate text-left font-mono text-[12px] text-mute underline-offset-2 hover:underline"
        >
          <span className="truncate">{publicLabel}</span>
        </button>
        <button
          type="button"
          aria-label={t("profile.copyLink")}
          onClick={() => void copyPublicUrl()}
          className="flex h-11 w-11 flex-none cursor-pointer items-center justify-center text-mute hover:text-ink"
        >
          <Copy aria-hidden size={15} strokeWidth={2.2} />
        </button>
      </div>

      <div className="flex items-end gap-2">
        <TextField
          className="flex-1"
          label={t("profile.nameLabel")}
          value={nameDraft}
          maxLength={NAME_MAX_LENGTH}
          onChange={(event) => setNameDraft(event.target.value)}
        />
        <Button
          variant="primary"
          className="flex-none"
          loading={savingName}
          disabled={!nameDirty || savingName}
          onClick={() => void saveName()}
        >
          {t("common.save")}
        </Button>
      </div>

      <BottomSheet
        open={nickOpen}
        onClose={() => {
          if (savingNick) return;
          setNickOpen(false);
        }}
        title={t("profile.nicknameSheetTitle")}
        footer={
          <>
            <Button
              className="flex-1"
              disabled={savingNick}
              onClick={() => setNickOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              loading={savingNick}
              disabled={nickState !== "free" || !nickDirty || savingNick}
              onClick={() => void saveNickname()}
            >
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-1.5 pb-1">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">
            {t("auth.onboarding.nickname")}
          </span>
          <div className="flex min-h-11 items-center border border-rule-2 bg-paper px-3 font-mono text-[14px] focus-within:border-accent focus-within:shadow-[inset_0_0_0_1px_var(--accent)]">
            <span className="text-mute-2">/u/</span>
            <input
              aria-label={t("auth.onboarding.nickname")}
              value={nickDraft}
              maxLength={30}
              onChange={(event) => setNickDraft(event.target.value)}
              className="min-w-0 flex-1 bg-transparent outline-none"
            />
            <span className="pl-2 text-[12px]">
              {nickState === "checking" && (
                <span className="text-mute-2">…</span>
              )}
              {nickState === "free" && <span className="text-accent">✓</span>}
              {nickState === "taken" && <span className="text-neg">✕</span>}
            </span>
          </div>
          {nickState === "taken" && (
            <span className="text-[11px] text-neg">
              {t("auth.onboarding.nicknameTaken")}
            </span>
          )}
          {nickState === "invalid" && (
            <span className="text-[11px] text-neg">
              {t("auth.onboarding.nicknameInvalid")}
            </span>
          )}
          <p className="border-l-3 border-null-rule bg-null py-1.5 pl-3 text-[11.5px] text-null-txt">
            {t("profile.nicknameWarning")}
          </p>
        </div>
      </BottomSheet>

      <InfoToast
        open={copied}
        message={t("profile.copied")}
        onDismiss={() => setCopied(false)}
      />
      <InfoToast
        open={saved}
        message={t("params.saved")}
        onDismiss={() => setSaved(false)}
      />
      <InfoToast
        open={failed}
        message={t("common.actionFailed")}
        onDismiss={() => setFailed(false)}
      />
    </header>
  );
}
