import { destroyImage, requireCloudinaryConfig } from "@/lib/cloudinary";
import { AVATAR_FOLDER, cardArtUrl, cardPublicId, cardUploadVersion, withCardArtVersion } from "@/lib/member-avatar";
import { ApiError, jsonError, requireAdmin } from "@/lib/supabase-admin";

type Body = {
  username?: string;
  cardUrl?: string | null;
};

// POST /api/member-card { username, cardUrl } — admin saves an uploaded celebration picture, or removes it with null.
export async function POST(request: Request) {
  try {
    const { admin } = await requireAdmin(request);
    const config = requireCloudinaryConfig();
    const body = await request.json().catch(() => ({})) as Body;
    const username = String(body.username || "").trim().toLowerCase();
    const cardUrl = body.cardUrl ?? null;

    if (!username) throw new ApiError(400, "Thiếu tên đăng nhập của thành viên.");
    const version = cardUrl === null ? "none" : cardUploadVersion(cardUrl, config.cloudName, username);
    if (!version) throw new ApiError(400, "Ảnh ăn mừng không hợp lệ.");

    const { data: target, error: targetError } = await admin
      .from("profiles")
      .select("id, description")
      .eq("username", username)
      .eq("is_active", true)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) throw new ApiError(404, "Không tìm thấy thành viên.");

    const { error } = await admin.from("profiles").update({ description: withCardArtVersion(target.description, version) }).eq("id", target.id);
    if (error) throw error;

    // The profile no longer points at the image, so a failed clean-up only leaves an unused file.
    if (version === "none") await destroyImage(config, `${AVATAR_FOLDER}/${cardPublicId(username)}`).catch((destroyError) => console.error("Card art clean-up failed", destroyError instanceof Error ? destroyError.message : destroyError));

    return Response.json({ ok: true, cardUrl: version === "none" ? null : cardArtUrl(config.cloudName, username, version) });
  } catch (error) {
    return jsonError(error);
  }
}
