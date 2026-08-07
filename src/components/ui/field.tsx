import { useId } from "react";
import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { Link } from "lucide-react";

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Shared `.fin` border/bg/cursor state — same rules for <input> and <textarea>. */
function fieldStateClass(error: boolean, locked: boolean): string {
  return cx(
    error
      ? "border-neg"
      : "border-rule-2 focus:border-accent focus:shadow-[inset_0_0_0_1px_var(--accent)]",
    locked && "cursor-not-allowed border-dashed bg-zebra text-mute-2",
  );
}

const LABEL_CLASS =
  "text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute";

export type FieldVariant = "default" | "parsed-link";

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  locked?: boolean;
  variant?: FieldVariant;
  /** parsed-link only — trailing meta label (e.g. "from parser"). Caller supplies the string; this kit has no i18n of its own. */
  meta?: string;
}

/** Base `.fin` input. `variant="parsed-link"` renders a read-only display row (dashed, zebra, Link icon) instead of an editable input. */
export function Field({
  error = false,
  locked = false,
  variant = "default",
  meta,
  className,
  value,
  disabled,
  ...props
}: FieldProps) {
  if (variant === "parsed-link") {
    return (
      <div
        className={cx(
          "flex min-h-11 w-full items-center gap-2 border border-dashed border-rule-2 bg-zebra px-3 font-mono text-[14px] text-mute-2",
          className,
        )}
      >
        <Link aria-hidden className="h-3.5 w-3.5 flex-none" strokeWidth={2.4} />
        <span className="min-w-0 flex-1 truncate">{String(value ?? "")}</span>
        {meta && (
          <span className="flex-none font-sans text-[10px] text-mute-2">
            {meta}
          </span>
        )}
      </div>
    );
  }

  return (
    <input
      value={value}
      disabled={disabled || locked}
      className={cx(
        "min-h-11 w-full border bg-paper px-3 font-mono text-[14px] text-ink outline-none placeholder:text-mute-2",
        fieldStateClass(error, locked),
        className,
      )}
      {...props}
    />
  );
}

export interface TextFieldProps extends FieldProps {
  label: string;
  helperText?: string;
  id?: string;
}

/** Label + Field composition. `id` auto-generates via useId when not supplied (useId is safe outside "use client"). */
export function TextField({
  label,
  helperText,
  error = false,
  id,
  className,
  ...fieldProps
}: TextFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={fieldId} className={LABEL_CLASS}>
        {label}
      </label>
      <Field id={fieldId} error={error} {...fieldProps} />
      {error && helperText && (
        <p className="text-[11px] text-neg">{helperText}</p>
      )}
    </div>
  );
}

export interface TextareaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  helperText?: string;
  error?: boolean;
  locked?: boolean;
  id?: string;
}

/** Label + Textarea composition, same `.fin` recipe. No `parsed-link` variant — not a multi-line use case. */
export function TextareaField({
  label,
  helperText,
  error = false,
  locked = false,
  id,
  className,
  disabled,
  ...props
}: TextareaFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={fieldId} className={LABEL_CLASS}>
        {label}
      </label>
      <textarea
        id={fieldId}
        disabled={disabled || locked}
        className={cx(
          "min-h-11 w-full resize-y border bg-paper px-3 py-2 font-mono text-[14px] text-ink outline-none placeholder:text-mute-2",
          fieldStateClass(error, locked),
        )}
        {...props}
      />
      {error && helperText && (
        <p className="text-[11px] text-neg">{helperText}</p>
      )}
    </div>
  );
}
