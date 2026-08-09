"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { updateBaseCurrencyAction } from "@/app/profile/actions";
import { InfoToast } from "@/components/ui/toast";
import { CURRENCIES } from "@/lib/currencies";

/**
 * §6.6 base currency, under Настройки. Picking *is* the action (same rule as
 * the partner block): the value snaps back to the server's on failure, so the
 * select can never sit showing a currency that was not written.
 */
export function BaseCurrencySelect({ value }: { value: string }) {
  const t = useTranslations();
  const router = useRouter();
  const selectId = useId();

  const [current, setCurrent] = useState(value);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);

  async function pick(code: string) {
    const previous = current;
    setCurrent(code);
    setSaving(true);
    try {
      const result = await updateBaseCurrencyAction(code);
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setCurrent(previous);
        setFailed(true);
      }
    } catch {
      setCurrent(previous);
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={selectId}
        className="text-[10.5px] font-medium tracking-[0.1em] uppercase text-mute"
      >
        {t("profile.currencyLabel")}
      </label>
      <select
        id={selectId}
        value={current}
        disabled={saving}
        onChange={(event) => void pick(event.target.value)}
        className="min-h-11 cursor-pointer border border-rule-2 bg-paper px-3 font-mono text-[14px] outline-none focus:border-accent disabled:cursor-not-allowed"
      >
        {CURRENCIES.map((currency) => (
          <option key={currency.code} value={currency.code}>
            {currency.code} {currency.symbol}
          </option>
        ))}
      </select>
      <span className="text-[11px] text-mute-2">
        {t("auth.onboarding.currencyHint")}
      </span>

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
    </div>
  );
}
