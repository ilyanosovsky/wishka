import Link from "next/link";

/**
 * A §6.10 service screen: friendly one-line message plus a single way out.
 * Used for the invalid / deleted / no-access link states behind `/u` and `/w`.
 */
export type ServiceScreenProps = {
  title: string;
  ctaLabel: string;
  ctaHref: string;
};

export function ServiceScreen({
  title,
  ctaLabel,
  ctaHref,
}: ServiceScreenProps) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-105 flex-col items-center justify-center gap-4 px-5 text-center">
      <p className="font-serif text-[19px] font-semibold">{title}</p>
      <Link
        href={ctaHref}
        className="inline-flex min-h-11 items-center justify-center border border-accent bg-accent px-4 text-[13px] font-medium text-paper hover:bg-accent-ink"
      >
        {ctaLabel}
      </Link>
    </main>
  );
}
