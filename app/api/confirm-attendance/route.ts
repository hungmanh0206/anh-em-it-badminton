import { ApiError, jsonError, requireSessionManager } from "@/lib/supabase-admin";

type Body = {
  sessionId?: string;
};

type ProfileJoin = {
  is_active?: boolean | null;
};

type PendingAttendance = {
  profiles: ProfileJoin | ProfileJoin[] | null;
};

const toProfile = (profiles: ProfileJoin | ProfileJoin[] | null) => Array.isArray(profiles) ? profiles[0] : profiles;

export async function POST(request: Request) {
  try {
    const { admin } = await requireSessionManager(request);
    const body = await request.json().catch(() => ({})) as Body;
    if (!body.sessionId) throw new ApiError(400, "Thiếu phiên điểm danh.");

    const { data: playSession, error: sessionError } = await admin
      .from("play_sessions")
      .select("id, status")
      .eq("id", body.sessionId)
      .maybeSingle();

    if (sessionError) throw sessionError;
    if (!playSession) throw new ApiError(404, "Không tìm thấy phiên điểm danh.");

    if (playSession.status !== "draft") {
      return Response.json({ ok: true, status: playSession.status });
    }

    const { data: pendingRows, error: pendingError } = await admin
      .from("attendances")
      .select("profiles!attendances_member_id_fkey(is_active)")
      .eq("session_id", body.sessionId)
      .eq("choice", "pending");

    if (pendingError) throw pendingError;

    const hasPendingActiveMember = ((pendingRows || []) as PendingAttendance[])
      .some((attendance) => toProfile(attendance.profiles)?.is_active);

    if (hasPendingActiveMember) throw new ApiError(400, "Tất cả thành viên đang hoạt động cần phản hồi trước khi mở chọn số.");

    const now = new Date().toISOString();
    const { error: updateError } = await admin
      .from("play_sessions")
      .update({ status: "checked_in", attendance_confirmed_at: now, draw_open_at: now })
      .eq("id", body.sessionId)
      .eq("status", "draft");

    if (updateError) throw updateError;

    return Response.json({ ok: true, status: "checked_in" });
  } catch (error) {
    return jsonError(error);
  }
}
