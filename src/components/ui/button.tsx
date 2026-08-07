"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export type ButtonVariant = "default" | "primary" | "danger" | "ghost";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  default: "border border-rule-2 bg-paper text-ink hover:bg-bg",
  primary:
    "border border-accent bg-accent text-paper hover:border-accent-ink hover:bg-accent-ink",
  danger:
    "border border-[var(--red-rule)] bg-paper text-neg hover:bg-[var(--red-soft)]",
  ghost: "border-0 bg-transparent text-mute hover:underline",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  children?: ReactNode;
}

/** 44px tap target (Mini-System §3.6). `loading` swaps in a border spinner, dims the fill, and disables the button. */
export function Button({
  variant = "default",
  loading = false,
  disabled,
  type = "button",
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx(
        "inline-flex min-h-11 items-center justify-center gap-2 px-4 text-[13px] font-medium disabled:cursor-not-allowed",
        VARIANT_CLASS[variant],
        loading && "opacity-75",
        className,
      )}
      {...props}
    >
      {loading && (
        <span
          aria-hidden
          className="h-3.5 w-3.5 flex-none animate-spin rounded-round border-2 border-current/35 border-t-current"
        />
      )}
      {children}
    </button>
  );
}
