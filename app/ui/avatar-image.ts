import { AVATAR_SIZE } from "@/lib/member-avatar";

// Crops a picked photo to a round transparent PNG, the same shape as the bundled avatars, so every
// place that shows an avatar (including the BXH image, which draws it unclipped) looks the same.
export async function roundAvatarImage(file: File) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("Không đọc được ảnh này, hãy chọn ảnh JPG hoặc PNG.");
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Trình duyệt không xử lý được ảnh.");
  ctx.beginPath();
  ctx.arc(AVATAR_SIZE / 2, AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.imageSmoothingQuality = "high";
  // Tall photos keep their upper part, where the face usually is.
  const offsetY = (bitmap.height - side) * 0.25;
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, offsetY, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Trình duyệt không xử lý được ảnh.");
  return blob;
}
