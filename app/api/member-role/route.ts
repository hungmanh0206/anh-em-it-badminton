import { ApiError, clearSubAdminMarker, isMissingEnumValueError, jsonError, requireAdmin, setSubAdminMarker } from "@/lib/supabase-admin";

type Body = {
  username?: string;
  role?: "member" | "sub-admin";
};

export async function POST(request: Request) {
  try {
    const { admin, profile } = await requireAdmin(request);
    const body = await request.json().catch(() => ({})) as Body;
    const username = body.username?.trim().toLowerCase();
    const role = body.role;

    if (!username || !["member", "sub-admin"].includes(role || "")) throw new ApiError(400, "Role không hợp lệ.");
    if (username === "manh" || username === profile.username) throw new ApiError(400, "Mạnh luôn là Admin, không thể đổi role này.");

    const { data: target, error: targetError } = await admin
      .from("profiles")
      .select("id, username, role, description")
      .eq("username", username)
      .eq("is_active", true)
      .maybeSingle();

    if (targetError) throw targetError;
    if (!target) throw new ApiError(404, "Không tìm thấy thành viên.");
    if (target.role === "admin") throw new ApiError(400, "Không thể đổi role Admin.");

    const nextDescription = clearSubAdminMarker(target.description);
    const { error: updateRoleError } = await admin
      .from("profiles")
      .update({ role, description: nextDescription, updated_at: new Date().toISOString() })
      .eq("id", target.id)
      .neq("role", "admin");

    if (updateRoleError) {
      if (role !== "sub-admin" || !isMissingEnumValueError(updateRoleError)) throw updateRoleError;
      const { error: fallbackError } = await admin
        .from("profiles")
        .update({ description: setSubAdminMarker(target.description), updated_at: new Date().toISOString() })
        .eq("id", target.id)
        .neq("role", "admin");
      if (fallbackError) throw fallbackError;
    }

    return Response.json({ ok: true, role });
  } catch (error) {
    return jsonError(error);
  }
}
