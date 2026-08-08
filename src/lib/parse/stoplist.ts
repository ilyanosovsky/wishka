/**
 * Hosts that go straight to manual entry, no fetch attempted.
 *
 * Amazon is the whole list for now (VISION §5, live-tested Aug 2026): it serves
 * no useful metadata to a server-side fetch *and* its ToS forbids scraping, so
 * spending a pipeline run — and a user's daily quota — on it is pure waste.
 *
 * The pattern is anchored on both sides on purpose. `(^|\.)` stops
 * "myamazon.com" from matching, and capping what follows at one or two short
 * labels stops "amazon.phish.io" — a lookalike host we have no reason to
 * refuse, and more importantly a shape an attacker could use to make the
 * stop-list fire on their own domain.
 */
const AMAZON_HOST_RE = /(^|\.)amazon\.[a-z]{2,3}(\.[a-z]{2,3})?$/;

export function isStoplisted(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return false;
  }
  return AMAZON_HOST_RE.test(hostname);
}
