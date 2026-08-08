/**
 * The group colour allow-list, kept in a database-free module so the swatch
 * picker can import it without dragging the Drizzle schema (and, one
 * `server-only` marker away, the whole data layer) into the client bundle.
 *
 * The values are opaque keys, not CSS: the data layer stores the key, and
 * `group-mark.tsx` owns the token pairs each key renders as.
 */
export const GROUP_COLORS = [
  "ink",
  "accent",
  "null",
  "zebra",
  "rule",
  "mute",
] as const;

export type GroupColor = (typeof GROUP_COLORS)[number];

export function isGroupColor(value: string): value is GroupColor {
  return (GROUP_COLORS as readonly string[]).includes(value);
}
