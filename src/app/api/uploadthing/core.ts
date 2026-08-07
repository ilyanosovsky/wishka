import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";
import { getDb } from "@/db";
import { user } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { storage } from "@/lib/storage";
import { extractStorageKey } from "@/lib/storage/uploadthing";
import { consumeUploadQuota } from "@/lib/upload-quota";

const f = createUploadthing();

export const uploadRouter = {
  /** Avatars are downscaled client-side (≤512px webp) before upload.
   *  The server persists user.image itself — the client never gets to
   *  choose the stored URL (invariant #6: no hotlinking). */
  avatar: f({ image: { maxFileSize: "2MB", maxFileCount: 1 } })
    .middleware(async () => {
      const session = await getAuth().api.getSession({
        headers: await headers(),
      });
      if (!session) throw new UploadThingError("Unauthorized");
      if (!(await consumeUploadQuota(session.user.id))) {
        throw new UploadThingError("Upload limit reached for today");
      }
      return { userId: session.user.id };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      const db = getDb();
      const [current] = await db
        .select({ image: user.image })
        .from(user)
        .where(eq(user.id, metadata.userId));

      await db
        .update(user)
        .set({ image: file.ufsUrl, updatedAt: new Date() })
        .where(eq(user.id, metadata.userId));

      // Replacing an avatar must not orphan the old file.
      const oldKey = current?.image ? extractStorageKey(current.image) : null;
      if (oldKey && oldKey !== file.key) {
        await storage.delete(oldKey).catch(() => {
          // Losing a cleanup is acceptable; failing the upload is not.
        });
      }
      return { url: file.ufsUrl };
    }),
} satisfies FileRouter;

export type UploadRouter = typeof uploadRouter;
