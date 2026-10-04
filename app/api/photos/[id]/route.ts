import { destroyImage, requireCloudinaryConfig } from "@/lib/cloudinary";
import { markPhotosDeleted, photosDbError } from "@/lib/photos/repository";
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
