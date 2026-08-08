"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CURRENCIES } from "@/lib/currencies";
import { downscaleToSquare } from "@/lib/image";
import { NICKNAME_RE } from "@/lib/nickname";
import { useUploadThing } from "@/lib/uploadthing-client";
import {
  checkNickname,
  completeOnboarding,
  skipOnboarding,
  type NicknameCheck,
} from "./actions";

type NicknameState = NicknameCheck | "checking" | "idle";

export function OnboardingForm({
  defaultName,
  defaultNickname,
  next = "/",
}: {
  defaultName: string;
  defaultNickname: string;
  /** Where finishing (or skipping) onboarding should land, from `/welcome?next=`. */
  next?: string;
}) {
  const t = useTranslations("auth.onboarding");
  const [name, setName] = useState(defaultName);
  const [nickname, setNickname] = useState(defaultNickname);
  // Async check results keyed by the value they were computed for; the
  // displayed state derives in render — no setState inside effects.
  const [check, setCheck] = useState<{
    value: string;
    result: NicknameCheck;
  } | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [submitting, startSubmit] = useTransition();
  const [skipping, startSkip] = useTransition();

  const { startUpload } = useUploadThing("avatar");

  const nicknameValue = nickname.trim().toLowerCase();
  const nicknameState: NicknameState = !nicknameValue
    ? "idle"
    : !NICKNAME_RE.test(nicknameValue)
      ? "invalid"
      : check?.value === nicknameValue
        ? check.result
        : "checking";

  useEffect(() => {
    const value = nickname.trim().toLowerCase();
    if (!value || !NICKNAME_RE.test(value)) return;
    const timer = setTimeout(async () => {
      const result = await checkNickname(value);
      setCheck({ value, result });
    }, 400);
    return () => clearTimeout(timer);
  }, [nickname]);

  async function onAvatarPick(file: File | undefined) {
    if (!file) return;
    setAvatarError(false);
    setUploadingAvatar(true);
    try {
      const small = await downscaleToSquare(file);
      const uploaded = await startUpload([small]);
      const url = uploaded?.[0]?.ufsUrl;
      if (!url) throw new Error("upload failed");
      setImageUrl(url);
    } catch {
      setAvatarError(true);
    } finally {
      setUploadingAvatar(false);
    }
  }

  function submit() {
    startSubmit(async () => {
      const value = nickname.trim().toLowerCase();
      // Avatar is persisted server-side by the upload route; imageUrl here
      // is only the local preview.
      const result = await completeOnboarding(
        {
          name,
          nickname: value,
          baseCurrency: currency,
        },
        next,
      );
      if (result?.error === "nickname") setCheck({ value, result: "taken" });
    });
  }

  const canSubmit = !submitting && !uploadingAvatar && nicknameState === "free";

  return (
    <div className="flex flex-col gap-5">
      {/* Avatar */}
      <label className="flex cursor-pointer items-center gap-4">
        {imageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element -- avatar preview from our CDN, unoptimized by design */
          <img
            src={imageUrl}
            alt=""
            className="h-16 w-16 rounded-round border border-rule-2 object-cover"
          />
        ) : (
          <span className="flex h-16 w-16 items-center justify-center rounded-round border border-dashed border-rule-2 text-[20px] text-mute-2">
            +
          </span>
        )}
        <span className="text-[12px] text-mute">
          {uploadingAvatar ? t("avatarUploading") : t("avatar")}
          {avatarError && (
            <span className="block text-neg">{t("avatarError")}</span>
          )}
        </span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          disabled={uploadingAvatar}
          onChange={(e) => void onAvatarPick(e.target.files?.[0])}
        />
      </label>

      {/* Name */}
      <label className="flex flex-col gap-1.5">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-mute">
          {t("name")}
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-h-11 border border-rule-2 bg-paper px-3 text-[14px] outline-none focus:border-accent focus:shadow-[inset_0_0_0_1px_var(--accent)]"
        />
      </label>

      {/* Nickname */}
      <label className="flex flex-col gap-1.5">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-mute">
          {t("nickname")}
        </span>
        <div className="flex min-h-11 items-center border border-rule-2 bg-paper px-3 font-mono text-[14px] focus-within:border-accent focus-within:shadow-[inset_0_0_0_1px_var(--accent)]">
          <span className="text-mute-2">wishka.app/u/</span>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            className="min-w-0 flex-1 bg-transparent outline-none"
          />
          <span className="pl-2 text-[12px]">
            {nicknameState === "checking" && (
              <span className="text-mute-2">…</span>
            )}
            {nicknameState === "free" && <span className="text-accent">✓</span>}
            {nicknameState === "taken" && <span className="text-neg">✕</span>}
          </span>
        </div>
        {nicknameState === "taken" && (
          <span className="text-[11px] text-neg">{t("nicknameTaken")}</span>
        )}
        {nicknameState === "invalid" && (
          <span className="text-[11px] text-neg">{t("nicknameInvalid")}</span>
        )}
      </label>

      {/* Base currency */}
      <label className="flex flex-col gap-1.5">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-mute">
          {t("currency")}
        </span>
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className="min-h-11 cursor-pointer border border-rule-2 bg-paper px-3 font-mono text-[14px] outline-none focus:border-accent"
        >
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} {c.symbol}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-mute-2">{t("currencyHint")}</span>
      </label>

      <button
        onClick={submit}
        disabled={!canSubmit}
        className="min-h-11 cursor-pointer border border-accent bg-accent px-4 text-[13px] font-medium text-paper hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-75"
      >
        {submitting ? t("saving") : t("done")}
      </button>

      <button
        onClick={() => startSkip(() => skipOnboarding(next))}
        disabled={skipping}
        className="cursor-pointer self-center text-[12px] text-mute underline-offset-2 hover:underline"
      >
        {t("skip")}
      </button>
    </div>
  );
}
