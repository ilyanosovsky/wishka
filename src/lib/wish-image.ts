/** Client-side: proportional downscale before upload (free-tier storage has no
 *  server-side resizing — see CLAUDE.md). Unlike `downscaleToSquare` in
 *  `src/lib/image.ts` (avatars: center-crop to a square), wish photos keep
 *  their aspect ratio — a product shot cropped to 1:1 loses the product. */
export async function downscaleForWish(
  file: File,
  maxDimension = 1024,
): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(
    1,
    maxDimension / Math.max(bitmap.width, bitmap.height),
  );
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.85),
  );
  if (!blob) throw new Error("Image encoding failed");
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".webp", {
    type: "image/webp",
  });
}
