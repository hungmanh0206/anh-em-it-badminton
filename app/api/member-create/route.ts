import { currentEloRatings } from "@/lib/elo/server";
import { newMemberStartRating, withEloStart } from "@/lib/elo/start-rating";
import { isValidMemberUsername, MEMBER_EMAIL_DOMAIN, MEMBER_PASSWORD_MIN, usernameFromName } from "@/lib/member-username";
import { ApiError, clearSubAdminMarker, isMissingEnumValueError, jsonError, requireAdmin, setSubAdminMarker } from "@/lib/supabase-admin";

type Body = {
  name?: string;
  role?: "member" | "sub-admin";
  password?: string;
};

// POST /api/member-create { name, role, password } — admin only.
// Creates the login (username derived from the name) and the profile; a previously removed
// member with the same username is reactivated with the new password instead (keeping their history).
// A brand-new member's starting ELO sits below the Level 1 cut-off, so they always join as Level 2.
export async function POST(request: Request) {
  try {
    const { admin } = await requireAdmin(request);
    const body = await request.json().catch(() => ({})) as Body;
    const name = String(body.name || "").replace(/\s+/g, " ").trim();
    const username = usernameFromName(name);
    const role = body.role === "sub-admin" ? "sub-admin" : "member";
    const password = String(body.password || "");

    if (name.length < 2 || name.length > 40) throw new ApiError(400, "Tên thành viên cần từ 2 đến 40 ký tự.");
    if (!isValidMemberUsername(username)) throw new ApiError(400, "Tên cần có chữ cái hoặc số để tạo tên đăng nhập.");
    if (password.length < MEMBER_PASSWORD_MIN || password.length > 72) throw new ApiError(400, `Mật khẩu cần từ ${MEMBER_PASSWORD_MIN} đến 72 ký tự.`);

    const { data: existing, error: existingError } = await admin
      .from("profiles")
      .select("id, is_active, description")
      .eq("username", username)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing?.is_active) throw new ApiError(409, `Tên đăng nhập "${username}" đã có người dùng.`);

    const saveProfile = async (id: string, description: string | null, insert: boolean) => {
      const fields = { username, full_name: name, role, level: "2", is_active: true, description, updated_at: new Date().toISOString() };
      const write = (values: typeof fields) => (insert ? admin.from("profiles").insert({ id, ...values }) : admin.from("profiles").update(values).eq("id", id));
      const { error } = await write(fields);
      if (!error) return;
      if (role !== "sub-admin" || !isMissingEnumValueError(error)) throw error;
      const { error: fallbackError } = await write({ ...fields, role: "member", description: setSubAdminMarker(description) });
      if (fallbackError) throw fallbackError;
    };

    if (existing) {
      const { error: passwordError } = await admin.auth.admin.updateUserById(existing.id, { password });
      if (passwordError) throw passwordError;
      await saveProfile(existing.id, clearSubAdminMarker(existing.description), false);
      return Response.json({ ok: true, username, reactivated: true });
    }

    const startRating = newMemberStartRating(await currentEloRatings(admin));
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: `${username}@${MEMBER_EMAIL_DOMAIN}`,
      password,
      email_confirm: true,
      user_metadata: { username, full_name: name },
    });
    if (createError || !created.user) {
      if (/already|registered|exists/i.test(createError?.message || "")) throw new ApiError(409, `Tài khoản "${username}" đã tồn tại trên hệ thống đăng nhập.`);
      throw createError ?? new ApiError(500, "Không tạo được tài khoản đăng nhập.");
    }

    try {
      await saveProfile(created.user.id, withEloStart(null, startRating), true);
    } catch (profileError) {
      // Never leave a login without a profile behind.
      await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
      throw profileError;
    }
    return Response.json({ ok: true, username, startRating });
  } catch (error) {
    return jsonError(error);
  }
}
