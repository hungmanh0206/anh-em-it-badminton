import { createClient } from "@supabase/supabase-js";

export type MemberRole = "admin" | "sub-admin" | "member";
export const SUB_ADMIN_ROLE_MARKER = "[aemit-role:sub-admin]";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function createSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secretKey) throw new ApiError(500, "Server chưa có Supabase secret để lưu kết quả.");
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type AuthProfile = {
  id: string;
  role: MemberRole;
  full_name?: string | null;
  username?: string | null;
  level?: "1" | "2" | number | string | null;
  description?: string | null;
};

export const effectiveMemberRole = (role?: string | null, description?: string | null): MemberRole => {
  if (role === "admin") return "admin";
  if (role === "sub-admin" || String(description || "").includes(SUB_ADMIN_ROLE_MARKER)) return "sub-admin";
  return "member";
};

export async function requireUser(request: Request) {
  const admin = createSupabaseAdmin();
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new ApiError(401, "Bạn cần đăng nhập lại.");

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) throw new ApiError(401, "Phiên đăng nhập không hợp lệ.");

  const { data: profile, error: profileError } = await admin.from("profiles").select("id, role, full_name, username, level, description").eq("id", authData.user.id).single();
  if (profileError || !profile) throw new ApiError(403, "Không tìm thấy hồ sơ người dùng.");

  const normalizedProfile = {
    ...profile,
    role: effectiveMemberRole(profile.role, profile.description),
  } as AuthProfile;

  return { admin, user: authData.user, profile: normalizedProfile };
}

export async function requireAdmin(request: Request) {
  const context = await requireUser(request);
  if (context.profile.role !== "admin") throw new ApiError(403, "Chỉ Admin được thực hiện thao tác này.");

  return context;
}

export async function requireScoreManager(request: Request) {
  const context = await requireUser(request);
  if (!["admin", "sub-admin"].includes(context.profile.role)) throw new ApiError(403, "Chỉ Admin hoặc Sub-admin được nhập, sửa và xác nhận điểm.");

  return context;
}

export function jsonError(error: unknown) {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: error instanceof Error ? error.message : "Có lỗi xảy ra." }, { status: 500 });
}
