import "server-only";

import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { aiUsage } from "@/db/schema";

const DAILY_UPLOAD_LIMIT = 20;

/**
 * Counts an upload against the user's daily quota (UTC day).
 * Returns false when the cap is exceeded — caller must reject the upload.
 */
export async function consumeUploadQuota(userId: string): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const [row] = await getDb()
    .insert(aiUsage)
    .values({ userId, day, kind: "upload", count: 1 })
    .onConflictDoUpdate({
      target: [aiUsage.userId, aiUsage.day, aiUsage.kind],
      set: { count: sql`${aiUsage.count} + 1` },
    })
    .returning({ count: aiUsage.count });
  return (row?.count ?? 1) <= DAILY_UPLOAD_LIMIT;
}
