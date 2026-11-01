import { requireCloudinaryConfig } from "@/lib/cloudinary";
import { AVATAR_FOLDER, avatarPublicId } from "@/lib/member-avatar";
import { signParams } from "@/lib/photos/cloudinary-sign";
import { ApiError, jsonError, requireAdmin } from "@/lib/supabase-admin";

// POST /api/member-avatar/sign { username } — signed parameters for a direct browser -> Cloudinary
// upload of that member's avatar. A new upload replaces the old image. Image bytes never touch Vercel.
export async function POST(request: Request) {
  try {
    const { admin } = await requireAdmin(request);
    const config = requireCloudinaryConfig();
    const body = await request.json().catch(() => ({})) as { username?: string };
    const username = String(body.username || "").trim().toLowerCase();
    if (!username) throw new ApiError(400, "Thiếu tên đăng nhập của thành viên.");

    const { data: target, error } = await admin.from("profiles").select("id").eq("username", username).eq("is_active", true).maybeSingle();
    if (error) throw error;
    if (!target) throw new ApiError(404, "Không tìm thấy thành viên.");

    const timestamp = Math.floor(Date.now() / 1000);
    const params = { folder: AVATAR_FOLDER, public_id: avatarPublicId(username), overwrite: "true", invalidate: "true", allowed_formats: "png", timestamp };
    return Response.json({
      uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/upload`,
      apiKey: config.apiKey,
      signature: signParams(params, config.apiSecret),
      ...params,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
