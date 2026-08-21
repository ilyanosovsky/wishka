"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export interface TabBarItem {
  key: string;
  label: string;
  icon: LucideIcon;
  href: string;
}

export interface TabBarProps {
  items: TabBarItem[];
  ariaLabel?: string;
  className?: string;
  /** Wordmark shown only when the bottom bar becomes the desktop sidebar. */
  desktopBrand?: string;
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Mobile bottom nav that becomes the app's left sidebar at `lg`.
 *
 * The mobile geometry stays exactly as designed in Directions §turn-3. The
 * desktop treatment changes only placement and item composition, keeping the
 * same routes, labels, icon family and active-state semantics.
 */
export function TabBar({
  items,
  ariaLabel,
  className,
  desktopBrand,
}: TabBarProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={ariaLabel}
      data-app-navigation={desktopBrand ? "true" : undefined}
      className={cx(
        "fixed inset-x-0 bottom-0 z-40 flex border-t-2 border-ink bg-paper pb-[env(safe-area-inset-bottom)] lg:inset-y-0 lg:right-auto lg:w-68 lg:flex-col lg:border-t-0 lg:border-r-2 lg:px-5 lg:pt-7 lg:pb-24",
        className,
      )}
    >
      {desktopBrand && (
        <Link
          href="/"
          className="mb-8 hidden border-b-2 border-ink pb-5 font-serif text-[27px] leading-none font-semibold tracking-[-0.01em] lg:block"
        >
          {desktopBrand}
        </Link>
      )}
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 lg:min-h-12 lg:w-full lg:flex-none lg:flex-row lg:justify-start lg:gap-3 lg:border-l-2 lg:px-3",
              active
                ? "font-semibold text-ink lg:border-accent lg:bg-accent-soft lg:text-accent-ink"
                : "text-mute-2 lg:border-transparent lg:hover:border-rule-2 lg:hover:bg-zebra lg:hover:text-ink",
            )}
          >
            <Icon
              aria-hidden
              size={20}
              strokeWidth={2.4}
              className="lg:h-[18px] lg:w-[18px]"
            />
            <span className="text-[10.5px] tracking-[0.1em] uppercase lg:text-[12px] lg:tracking-[0.08em]">
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
