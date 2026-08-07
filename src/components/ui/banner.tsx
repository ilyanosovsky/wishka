import type { ReactNode } from "react";

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export type BannerTone = "error" | "warning" | "success" | "info";

const TONE_CLASS: Record<BannerTone, string> = {
  error: "border-neg text-neg bg-[var(--red-soft)]",
  warning: "border-null-rule text-null-txt bg-null",
  success: "border-accent text-accent-ink bg-accent-soft",
  info: "border-accent text-accent-ink bg-accent-soft",
};

export interface AlertBannerProps {
  tone: BannerTone;
  children: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  actionHref?: string;
  className?: string;
}

/** Left-rule alert strip. `actionHref` renders an <a>, otherwise `onAction` renders a <button> — never both. */
export function AlertBanner({
  tone,
  children,
  actionLabel,
  onAction,
  actionHref,
  className,
}: AlertBannerProps) {
  return (
    <div
      className={cx(
        "flex items-center gap-3 border-l-[3px] py-1.5 pr-3 pl-3 text-[12px]",
        TONE_CLASS[tone],
        className,
      )}
    >
      <span className="flex-1">{children}</span>
      {actionLabel &&
        (actionHref ? (
          <a
            href={actionHref}
            className="flex-none font-semibold underline-offset-2 hover:underline"
          >
            {actionLabel}
          </a>
        ) : (
          <button
            type="button"
            onClick={onAction}
            className="flex-none font-semibold underline-offset-2 hover:underline"
          >
            {actionLabel}
          </button>
        ))}
    </div>
  );
}
