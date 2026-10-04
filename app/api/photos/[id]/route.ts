import { destroyImage, requireCloudinaryConfig, updateDisplayName } from "@/lib/cloudinary";
import { markPhotosDeleted, PHOTO_COLUMNS, photosDbError, toApiPhoto, type PhotoRow } from "@/lib/photos/repository";
import { refreshAssets } from "@/lib/photos/sync";
import { ApiError, jsonError, requireAdmin } from "@/lib/supabase-admin";

// DELETE /api/photos/:id — deletes on Cloudinary first; the index is only updated after
// Cloudinary confirms. If Cloudinary fails, the row is kept and the error is returned.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { admin } = await requireAdmin(request);
    const config = requireCloudinaryConfig();
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(400, "Mã ảnh không hợp lệ.");

    const { data: photo, error } = await admin.from("photos").select("id, cloudinary_asset_id, public_id, is_deleted").eq("id", id).maybeSingle();
    if (error) throw photosDbError(error);
    if (!photo) throw new ApiError(404, "Không tìm thấy ảnh.");
    if (photo.is_deleted) return Response.json({ ok: true, alreadyDeleted: true });

    const result = await destroyImage(config, photo.public_id);
    try {
      await markPhotosDeleted(admin, [photo.cloudinary_asset_id]);
    } catch {
      // Cloudinary already deleted the asset; the delete webhook or the next sync will fix the index.
      throw new ApiError(500, "Đã xóa ảnh trên Cloudinary nhưng chưa cập nhật được kho ảnh. Ảnh sẽ tự biến mất sau lần đồng bộ tiếp theo.");
    }
    return Response.json({ ok: true, cloudinary: result });
  } catch (error) {
    return jsonError(error);
  }
}

// PATCH /api/photos/:id { name } — renames the photo's display name on Cloudinary, then re-reads
// the asset to refresh the index (the display-name webhook that follows is idempotent).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { admin } = await requireAdmin(request);
    const config = requireCloudinaryConfig();
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(400, "Mã ảnh không hợp lệ.");
    const body = await request.json().catch(() => ({})) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, "").trim() : "";
    if (!name || name.length > 100) throw new ApiError(400, "Tên ảnh cần từ 1 đến 100 ký tự.");
    if (/[/\\]/.test(name)) throw new ApiError(400, "Tên ảnh không được chứa dấu / hoặc \\.");

    const { data: photo, error } = await admin.from("photos").select("id, cloudinary_asset_id, is_deleted").eq("id", id).maybeSingle();
    if (error) throw photosDbError(error);
    if (!photo || photo.is_deleted) throw new ApiError(404, "Không tìm thấy ảnh.");

    await updateDisplayName(config, photo.cloudinary_asset_id, name);
    await refreshAssets(admin, config, [photo.cloudinary_asset_id]);
    const { data: updated, error: readError } = await admin.from("photos").select(PHOTO_COLUMNS).eq("id", id).single();
    if (readError) throw photosDbError(readError);
    return Response.json({ photo: toApiPhoto(config.cloudName, updated as PhotoRow) });
  } catch (error) {
    return jsonError(error);
  }
}
