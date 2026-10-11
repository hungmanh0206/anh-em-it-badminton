import { MEMBER_PASSWORD_MIN } from "@/lib/member-username";
import { ApiError, jsonError, requireAdmin } from "@/lib/supabase-admin";

type Body = {
  username?: string;
  password?: string;
};

// POST /api/member-password { username, password } — admin sets a member's new password.
export async function POST(request: Request) {
  try {
    const { admin } = await requireAdmin(request);
    const body = await request.json().catch(() => ({})) as Body;
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (!username) throw new ApiError(400, "Thiếu tên đăng nhập của thành viên.");
    if (password.length < MEMBER_PASSWORD_MIN || password.length > 72) throw new ApiError(400, `Mật khẩu cần từ ${MEMBER_PASSWORD_MIN} đến 72 ký tự.`);

    const { data: target, error: targetError } = await admin
      .from("profiles")
      .select("id")
      .eq("username", username)
      .eq("is_active", true)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) throw new ApiError(404, "Không tìm thấy thành viên.");

    const { error } = await admin.auth.admin.updateUserById(target.id, { password });
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
