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
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Fixed bottom nav (3 items expected: List, Users, User). Safe-area padding clears the home indicator. */
export function TabBar({ items, ariaLabel, className }: TabBarProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={ariaLabel}
      className={cx(
        "fixed inset-x-0 bottom-0 z-40 flex border-t-2 border-ink bg-paper pb-[env(safe-area-inset-bottom)]",
        className,
      )}
    >
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex min-h-14 flex-1 flex-col items-center justify-center gap-1",
              active ? "font-semibold text-ink" : "text-mute-2",
            )}
          >
            <Icon aria-hidden size={20} strokeWidth={2.4} />
            <span className="text-[10.5px] uppercase tracking-[0.1em]">
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
