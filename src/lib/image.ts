/** Client-side: center-crop to a square and downscale before upload
 *  (free-tier storage has no server-side resizing — see CLAUDE.md). */
export async function downscaleToSquare(file: File, size = 512): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.min(size, side);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.85),
  );
  if (!blob) throw new Error("Image encoding failed");
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".webp", {
    type: "image/webp",
  });
}
