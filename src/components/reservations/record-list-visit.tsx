"use client";

import { useEffect } from "react";

import { recordRecentList } from "@/lib/recent-lists";

/**
 * Renders nothing; its whole job is the side effect. Mounted by `/u/[nickname]`
 * for visitors only — the owner's own list is not something they need a trail
 * back to, and putting it there would push a real visit out of the eight slots.
 */
export function RecordListVisit({
  nickname,
  name,
}: {
  nickname: string;
  name: string;
}) {
  useEffect(() => {
    recordRecentList({ nickname, name });
  }, [nickname, name]);

  return null;
}
