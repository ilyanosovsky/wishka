"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { getCachedParse, saveParse } from "@/db/access/parse-cache";
import { findActiveWishByUrl } from "@/db/access/wish-lookup";
import { getAuth } from "@/lib/auth";
import { createOpenAiExtractor } from "@/lib/parse/llm";
import { normalizeUrl, urlHash } from "@/lib/parse/normalize";
import { runPipeline, statusOf } from "@/lib/parse/pipeline";
import { consumeParseQuota } from "@/lib/parse/quota";
import { rehostImage } from "@/lib/parse/rehost";
import { isStoplisted } from "@/lib/parse/stoplist";
import type { ParseFields } from "@/lib/parse/types";
import { storage } from "@/lib/storage";
import { extractStorageKey } from "@/lib/storage/uploadthing";

export type { ParseFields };

/** Overall wall-clock budget for one parse (fetch layers + image re-host). */
const PARSE_BUDGET_MS = 22_000;

/**
 * Paste a link → the card assembles itself. Failure is never an error state:
 * every unhappy path returns `manual` with a reason, and the form the user is
 * already looking at just stays empty (product invariant #3).
 */
export type ParseOutcome =
  | { status: "ok" | "partial"; fields: ParseFields; url: string }
  | {
      status: "manual";
      reason: "stoplist" | "failed" | "quota" | "invalid_url";
      url: string;
    };

/** `duplicate` is answered on every outcome, including the manual ones — the
 *  user needs to know they already have this wish even if parsing got nowhere. */
export type ParseUrlResult = ParseOutcome & {
  duplicate: { id: string; title: string } | null;
};

async function requireUserId(): Promise<string> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return session.user.id;
}

export async function parseUrlAction(rawUrl: string): Promise<ParseUrlResult> {
  const userId = await requireUserId();

  const url = normalizeUrl(rawUrl);
  if (!url) {
    return {
      status: "manual",
      reason: "invalid_url",
      url: typeof rawUrl === "string" ? rawUrl.trim() : "",
      duplicate: null,
    };
  }

  const db = getDb();
  const duplicate = await findActiveWishByUrl(db, userId, url);

  // Amazon and friends: no fetch, no quota, straight to the manual form.
  if (isStoplisted(url)) {
    return { status: "manual", reason: "stoplist", url, duplicate };
  }

  // A URL someone already parsed costs nothing, so it is served before the
  // quota check rather than after it.
  const hash = urlHash(url);
  const cached = await getCachedParse(db, hash);
  if (cached) {
    return cached.status === "failed"
      ? { status: "manual", reason: "failed", url, duplicate }
      : { status: cached.status, fields: cached.fields, url, duplicate };
  }

  if (!(await consumeParseQuota(db, userId))) {
    return { status: "manual", reason: "quota", url, duplicate };
  }

  // ONE deadline for the whole parse. Summed per-layer timeouts (8+12+20s) plus
  // an image round-trip could otherwise run past two minutes; this bounds it so
  // the server action returns while the user is still looking at the form.
  const signal = AbortSignal.timeout(PARSE_BUDGET_MS);

  let status: ReturnType<typeof statusOf>;
  let fields: ParseFields;
  try {
    const result = await runPipeline(url, {
      fetchFn: fetch,
      llm: createOpenAiExtractor(),
      jinaKey: process.env.JINA_API_KEY ?? null,
      firecrawlKey: process.env.FIRECRAWL_API_KEY ?? null,
      signal,
    });
    fields = result.fields;

    // INVARIANT #6 — the shop's CDN URL must not survive past this point: it is
    // replaced by a copy on our storage, or dropped. This happens *before* the
    // cache write, so every later hit is served our own URL. `rehostImage`
    // re-fetches the bytes through the same SSRF guard and never throws.
    if (fields.imageUrl && !extractStorageKey(fields.imageUrl)) {
      fields.imageUrl = await rehostImage(fields.imageUrl, {
        storagePut: (data, name, contentType, sig) =>
          storage.putBuffer(data, name, contentType, { signal: sig }),
        signal,
      });
    }

    // Losing the image to a failed re-host can turn an "ok" parse into a
    // "partial" one, so the status is recomputed over what we are about to save.
    status = statusOf(fields);
  } catch {
    // Deadline hit or an unexpected throw: never surface an error to the user —
    // fall through to the manual form (invariant #3). Not cached, so a
    // transient timeout does not poison the shared cache.
    return { status: "manual", reason: "failed", url, duplicate };
  }

  await saveParse(db, hash, url, { status, fields });

  if (status === "failed") {
    return { status: "manual", reason: "failed", url, duplicate };
  }
  return { status, fields, url, duplicate };
}
