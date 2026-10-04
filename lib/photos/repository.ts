// Supabase side of the gallery: the `photos` table is an index of Cloudinary assets.
// All writes are idempotent upserts/updates keyed by cloudinary_asset_id.
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/supabase-admin";
import { deliveryUrls } from "@/lib/photos/assets";
import { folderLabel } from "@/lib/photos/folders";

export type PhotoRow = {
  id: string;
  cloudinary_asset_id: string;
  public_id: string;
  version: number | null;
  folder: string;
  format: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  display_name: string | null;
  taken_at: string;
  uploaded_by?: string | null;
};

export const PHOTO_COLUMNS = "id, cloudinary_asset_id, public_id, version, folder, format, width, height, bytes, display_name, taken_at, uploaded_by";

type PostgrestLikeError = { code?: string; message?: string } | null;

// Clear message when migration 010 has not been applied yet.
export function photosDbError(error: PostgrestLikeError): Error {
  const message = String(error?.message ?? "");
  const missingTable = error?.code === "PGRST205" || error?.code === "42P01" || (/photos|photo_folders/.test(message) && /schema cache|does not exist/.test(message));
  if (missingTable) {
    return new ApiError(503, "Kho ảnh chưa được khởi tạo database (cần chạy migration 010_photos.sql).");
  }
  return new ApiError(500, error?.message ? `Lỗi database kho ảnh: ${error.message}` : "Lỗi database kho ảnh.");
}

const CHUNK = 500;

// Inserts or refreshes rows; columns not provided (e.g. uploaded_by from webhooks) are left untouched.
export async function upsertPhotoRows(admin: SupabaseClient, rows: Record<string, unknown>[]) {
  const now = new Date().toISOString();
  for (let index = 0; index < rows.length; index += CHUNK) {
    const chunk = rows.slice(index, index + CHUNK).map((row) => ({ ...row, synced_at: now, updated_at: now }));
    const { error } = await admin.from("photos").upsert(chunk, { onConflict: "cloudinary_asset_id" });
    if (error) throw photosDbError(error);
  }
}

// Soft-deletes rows for assets that no longer exist on Cloudinary (or moved out of the root).
export async function markPhotosDeleted(admin: SupabaseClient, assetIds: string[]) {
  const now = new Date().toISOString();
  for (let index = 0; index < assetIds.length; index += 200) {
    const { error } = await admin
      .from("photos")
      .update({ is_deleted: true, deleted_at: now, updated_at: now, synced_at: now })
      .in("cloudinary_asset_id", assetIds.slice(index, index + 200))
      .eq("is_deleted", false);
    if (error) throw photosDbError(error);
  }
}

export const toApiPhoto = (cloudName: string, row: PhotoRow) => ({
  id: row.id,
  assetId: row.cloudinary_asset_id,
  publicId: row.public_id,
  folder: row.folder,
  folderLabel: folderLabel(row.folder),
  name: row.display_name || row.public_id.split("/").pop() || "Ảnh",
  width: row.width,
  height: row.height,
  takenAt: row.taken_at,
  ...deliveryUrls(cloudName, row),
});
