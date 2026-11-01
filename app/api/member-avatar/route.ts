import { destroyImage, requireCloudinaryConfig } from "@/lib/cloudinary";
import { avatarPublicIdFromUrl, isMemberAvatarUrl } from "@/lib/member-avatar";
import { ApiError, jsonError, requireAdmin } from "@/lib/supabase-admin";

type Body = {
  username?: string;
  avatarUrl?: string | null;
};

// POST /api/member-avatar { username, avatarUrl } — admin saves an uploaded avatar, or clears it with null.
export async function POST(request: Request) {
  try {
    const { admin } = await requireAdmin(request);
    const config = requireCloudinaryConfig();
    const body = await request.json().catch(() => ({})) as Body;
    const username = String(body.username || "").trim().toLowerCase();
    const avatarUrl = body.avatarUrl ?? null;

    if (!username) throw new ApiError(400, "Thiếu tên đăng nhập của thành viên.");
    if (avatarUrl !== null && !isMemberAvatarUrl(avatarUrl, config.cloudName, username)) throw new ApiError(400, "Ảnh đại diện không hợp lệ.");

    const { data: target, error: targetError } = await admin
      .from("profiles")
      .select("id, avatar_url")
      .eq("username", username)
      .eq("is_active", true)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) throw new ApiError(404, "Không tìm thấy thành viên.");

    const { error } = await admin.from("profiles").update({ avatar_url: avatarUrl }).eq("id", target.id);
    if (error) throw error;

    // The profile no longer points at the image, so a failed clean-up only leaves an unused file.
    const previousPublicId = avatarUrl === null ? avatarPublicIdFromUrl(target.avatar_url, config.cloudName) : null;
    if (previousPublicId) await destroyImage(config, previousPublicId).catch((destroyError) => console.error("Avatar clean-up failed", destroyError instanceof Error ? destroyError.message : destroyError));

    return Response.json({ ok: true, avatarUrl });
  } catch (error) {
    return jsonError(error);
  }
}
