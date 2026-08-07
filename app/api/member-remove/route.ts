import { ApiError, effectiveMemberRole, jsonError, requireAdmin } from "@/lib/supabase-admin";

type Body = {
  username?: string;
};

export async function POST(request: Request) {
  try {
    const { admin, profile } = await requireAdmin(request);
    const body = await request.json().catch(() => ({})) as Body;
    const username = body.username?.trim().toLowerCase();

    if (!username) throw new ApiError(400, "Thiếu username thành viên.");
    if (username === "manh" || username === profile.username) throw new ApiError(400, "Không thể xóa tài khoản Admin chính.");

    const { data: target, error: targetError } = await admin
      .from("profiles")
      .select("id, username, role, description")
      .eq("username", username)
      .eq("is_active", true)
      .maybeSingle();

    if (targetError) throw targetError;
    if (!target) throw new ApiError(404, "Không tìm thấy thành viên.");

    const targetRole = effectiveMemberRole(target.role, target.description);
    if (targetRole !== "member") throw new ApiError(400, "Chỉ được xóa thành viên role Thành viên. Admin và Sub-admin không thể xóa.");

    const { error: updateError } = await admin
      .from("profiles")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", target.id);

    if (updateError) throw updateError;

    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
