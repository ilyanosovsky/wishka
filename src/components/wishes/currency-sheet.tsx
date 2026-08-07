"use client";

import { Check, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Field } from "@/components/ui/field";
import { CURRENCIES, type CurrencyCode } from "@/lib/currencies";

const RECENT_KEY = "wishka-recent-currencies";
const MAX_RECENT = 3;

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

function readRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

/** Writes the updated list and returns it, so the caller can sync local
 *  state from the same event handler instead of an effect. */
function pushRecent(code: string): string[] {
  const next = [code, ...readRecent().filter((c) => c !== code)].slice(
    0,
    MAX_RECENT,
  );
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // localStorage can be unavailable (private mode, quota) — losing "recent" is fine.
    }
  }
  return next;
}

export type CurrencySheetProps = {
  open: boolean;
  onClose: () => void;
  /** Currently selected currency code, if any — used to mark the active row. */
  value: string | null;
  /** The signed-in user's base currency; always shown first in "recent". */
  baseCurrency: string;
  onSelect: (code: CurrencyCode) => void;
};

/** §6.3 "Валюта желания" sheet: search, then base+recent, then the full list. */
export function CurrencySheet({
  open,
  onClose,
  value,
  baseCurrency,
  onSelect,
}: CurrencySheetProps) {
  const t = useTranslations("form");
  const [query, setQuery] = useState("");
  // Lazy-init from localStorage once; `select` below keeps it in sync on every
  // pick, which covers the sheet's whole mounted lifetime without an effect.
  const [recent, setRecent] = useState<string[]>(() => readRecent());

  const normalizedQuery = query.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      CURRENCIES.filter(
        (c) =>
          !normalizedQuery ||
          c.code.toLowerCase().includes(normalizedQuery) ||
          c.symbol.toLowerCase().includes(normalizedQuery),
      ),
    [normalizedQuery],
  );

  const recentEntries = useMemo(() => {
    const codes = [baseCurrency, ...recent].filter(
      (code, index, arr) => arr.indexOf(code) === index,
    );
    return codes
      .map((code) => CURRENCIES.find((c) => c.code === code))
      .filter((c): c is (typeof CURRENCIES)[number] => Boolean(c));
  }, [baseCurrency, recent]);

  function select(code: CurrencyCode) {
    setRecent(pushRecent(code));
    onSelect(code);
    onClose();
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={t("currencyLabel")}>
      <div className="flex flex-col gap-1 pb-2">
        <div className="relative">
          <Search
            aria-hidden
            size={13}
            strokeWidth={2.2}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-mute-2"
          />
          <Field
            aria-label={t("currencySearch")}
            placeholder={t("currencySearch")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-8"
          />
        </div>

        {!normalizedQuery && recentEntries.length > 0 && (
          <div className="flex flex-col">
            <span className="pt-3 pb-1 font-mono text-[9.5px] font-semibold tracking-[0.1em] text-mute-2 uppercase">
              {t("currencyRecent")}
            </span>
            {recentEntries.map((c) => (
              <CurrencyRow
                key={c.code}
                code={c.code}
                symbol={c.symbol}
                active={c.code === value}
                onClick={() => select(c.code)}
              />
            ))}
          </div>
        )}

        <div className="flex flex-col">
          <span className="pt-3 pb-1 font-mono text-[9.5px] font-semibold tracking-[0.1em] text-mute-2 uppercase">
            {t("currencyAll")}
          </span>
          {filtered.map((c) => (
            <CurrencyRow
              key={c.code}
              code={c.code}
              symbol={c.symbol}
              active={c.code === value}
              onClick={() => select(c.code)}
            />
          ))}
        </div>
      </div>
    </BottomSheet>
  );
}

function CurrencyRow({
  code,
  symbol,
  active,
  onClick,
}: {
  code: string;
  symbol: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex min-h-11 cursor-pointer items-center gap-2.5 border-t border-rule text-[13px] first:border-t-0",
        active && "font-semibold",
      )}
    >
      <span className="w-5 flex-none font-mono text-mute-2">{symbol}</span>
      <span className="flex-1 text-left">{code}</span>
      {active && (
        <Check
          aria-hidden
          size={14}
          strokeWidth={2.6}
          className="flex-none text-accent"
        />
      )}
    </button>
  );
}
