import { jsonError, requireAdmin } from "@/lib/supabase-admin";

type Body = {
  sessionId?: string;
  status?: "scheduled";
};

export async function POST(request: Request) {
  try {
    const { admin } = await requireAdmin(request);
    const body = await request.json() as Body;
    if (!body.sessionId || body.status !== "scheduled") return Response.json({ error: "Trạng thái phiên không hợp lệ." }, { status: 400 });

    const { data: attendances, error: attendanceError } = await admin
      .from("attendances")
      .select("drawn_number")
      .eq("session_id", body.sessionId)
      .eq("choice", "attending");
    if (attendanceError) throw attendanceError;
    if (!attendances?.length) return Response.json({ error: "Chưa có thành viên tham gia để tạo lịch." }, { status: 400 });
    if (attendances.some((attendance) => typeof attendance.drawn_number !== "number")) {
      return Response.json({ error: "Cần tất cả người tham gia bốc số trước khi tạo lịch." }, { status: 400 });
    }

    const { error } = await admin
      .from("play_sessions")
      .update({ status: "scheduled", schedule_mode: "level_based" })
      .eq("id", body.sessionId);
    if (error) throw error;

    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
