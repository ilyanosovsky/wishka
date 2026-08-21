import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getProfile } from "@/db/access/profiles";
import { getAudienceCandidates } from "@/db/access/visibility";
import { isAiAvailable } from "@/lib/ai/client";
import { getAiQuotaRemaining } from "@/lib/ai/quota";
import { getAuth } from "@/lib/auth";
import { NewWishForm } from "./new-wish-form";

/** §6.3 step 3 — the shared step-3 form, reached four ways: "Заполнить
 *  вручную" straight from the FAB sheet (no params), the manual fallback
 *  after a failed/stoplist/quota parse (`?url=`, link preserved), a
 *  successful/partial parse (`?parsed=1`, fields handed off via
 *  sessionStorage — see `new-wish-form.tsx`), or a "Добавь словами" AI draft
 *  (`?ai=1`, same sessionStorage-handoff shape). */
export default async function NewWishPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string; parsed?: string; ai?: string }>;
}) {
  const params = await searchParams;
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) {
    const qs = new URLSearchParams();
    if (params.url) qs.set("url", params.url);
    if (params.parsed) qs.set("parsed", params.parsed);
    if (params.ai) qs.set("ai", params.ai);
    const query = qs.toString();
    const own = query ? `/wishes/new?${query}` : "/wishes/new";
    redirect(`/login?next=${encodeURIComponent(own)}`);
  }
  // The audience candidates are read here, server-side: the client never
  // learns who is in the owner's groups except through this one prop. AI
  // availability is checked the same way — an unavailable key never even
  // reaches the client as a boolean to branch on, only as `ai` being absent.
  const aiAvailable = isAiAvailable();
  const [profile, candidates, aiQuota] = await Promise.all([
    getProfile(getDb(), session.user.id),
    getAudienceCandidates(getDb(), session.user.id),
    aiAvailable ? getAiQuotaRemaining(getDb(), session.user.id) : null,
  ]);

  return (
    <main className="mx-auto min-h-dvh max-w-105 px-6 pt-8 pb-10 lg:max-w-3xl lg:px-8 lg:pt-10 lg:pb-12">
      <NewWishForm
        baseCurrency={profile?.baseCurrency ?? "USD"}
        userId={session.user.id}
        candidates={candidates}
        url={params.url}
        parsed={params.parsed === "1"}
        aiHandoff={params.ai === "1"}
        ai={aiQuota ?? undefined}
      />
    </main>
  );
}
