"use client";

import { useRef } from "react";

/** Six mono boxes, auto-advance, paste-friendly — Paper Ledger OTP field.
 *  `digitLabel` is required, not defaulted: this kit has no i18n of its own,
 *  and a hardcoded English fallback is exactly how the boxes ended up
 *  announcing "Digit 1" to Russian users (invariant #7). */
export function OtpInput({
  value,
  onChange,
  digitLabel,
  disabled = false,
  invalid = false,
}: {
  value: string;
  onChange: (code: string) => void;
  /** Accessible name for the nth box, 1-based. */
  digitLabel: (n: number) => string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  function setDigit(index: number, digit: string) {
    const next = (value.slice(0, index) + digit + value.slice(index + 1)).slice(
      0,
      6,
    );
    onChange(next);
    if (digit && index < 5) refs.current[index + 1]?.focus();
  }

  function handleKeyDown(
    index: number,
    event: React.KeyboardEvent<HTMLInputElement>,
  ) {
    if (event.key === "Backspace" && !value[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  }

  function handlePaste(event: React.ClipboardEvent) {
    const digits = event.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, 6);
    if (digits) {
      event.preventDefault();
      onChange(digits);
      refs.current[Math.min(digits.length, 5)]?.focus();
    }
  }

  return (
    <div className="flex gap-2" onPaste={handlePaste}>
      {Array.from({ length: 6 }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={digitLabel(i + 1)}
          disabled={disabled}
          value={value[i] ?? ""}
          onChange={(e) => setDigit(i, e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => handleKeyDown(i, e)}
          className={`h-13 w-10 border bg-paper text-center font-mono text-[18px] outline-none focus:border-accent focus:shadow-[inset_0_0_0_1px_var(--accent)] disabled:cursor-not-allowed disabled:bg-zebra disabled:text-mute-2 ${
            invalid ? "border-neg" : "border-rule-2"
          }`}
        />
      ))}
    </div>
  );
}
