import { createClient } from "@supabase/supabase-js";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function createSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secretKey) throw new ApiError(500, "Server chưa có Supabase secret để lưu kết quả.");
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type AuthProfile = {
  id: string;
  role: "admin" | "member" | string;
  full_name?: string | null;
  username?: string | null;
  level?: "1" | "2" | number | string | null;
};

export async function requireUser(request: Request) {
  const admin = createSupabaseAdmin();
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new ApiError(401, "Bạn cần đăng nhập lại.");

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) throw new ApiError(401, "Phiên đăng nhập không hợp lệ.");

  const { data: profile, error: profileError } = await admin.from("profiles").select("id, role, full_name, username, level").eq("id", authData.user.id).single();
  if (profileError || !profile) throw new ApiError(403, "Không tìm thấy hồ sơ người dùng.");

  return { admin, user: authData.user, profile: profile as AuthProfile };
}

export async function requireAdmin(request: Request) {
  const context = await requireUser(request);
  if (context.profile.role !== "admin") throw new ApiError(403, "Chỉ Admin được thực hiện thao tác này.");

  return context;
}

export function jsonError(error: unknown) {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: error instanceof Error ? error.message : "Có lỗi xảy ra." }, { status: 500 });
}
