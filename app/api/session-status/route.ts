import { jsonError, requireSessionManager } from "@/lib/supabase-admin";
import { drawSlotsForLevel, hasScheduleScenario } from "@/lib/draw-reassign";

type Body = {
  sessionId?: string;
  status?: "scheduled";
};

type ProfileJoin = {
  level?: "1" | "2" | number | string | null;
};

type AttendanceWithProfile = {
  drawn_number: number | null;
  level_at_time?: "1" | "2" | number | string | null;
  profiles: ProfileJoin | ProfileJoin[] | null;
};

const toProfile = (profiles: ProfileJoin | ProfileJoin[] | null) => Array.isArray(profiles) ? profiles[0] : profiles;
const toLevel = (level: ProfileJoin["level"]): 1 | 2 => Number(level) === 1 ? 1 : 2;
const attendanceLevel = (attendance: AttendanceWithProfile): 1 | 2 =>
  toLevel(attendance.level_at_time ?? toProfile(attendance.profiles)?.level);

export async function POST(request: Request) {
  try {
    const { admin } = await requireSessionManager(request);
    const body = await request.json() as Body;
    if (!body.sessionId || body.status !== "scheduled") return Response.json({ error: "Trạng thái phiên không hợp lệ." }, { status: 400 });

    const { data: attendances, error: attendanceError } = await admin
      .from("attendances")
      .select("drawn_number, level_at_time, profiles!attendances_member_id_fkey(level)")
      .eq("session_id", body.sessionId)
      .eq("choice", "attending");
    if (attendanceError) throw attendanceError;
    const attendanceRows = (attendances || []) as AttendanceWithProfile[];
    if (!attendanceRows.length) return Response.json({ error: "Chưa có thành viên tham gia để tạo lịch." }, { status: 400 });

    const level1Count = attendanceRows.filter((attendance) => attendanceLevel(attendance) === 1).length;
    const level2Count = attendanceRows.length - level1Count;
    if (!hasScheduleScenario(attendanceRows.length, level1Count)) {
      return Response.json({ error: `Chưa có mẫu lịch phù hợp cho ${attendanceRows.length} người (${level1Count} Level 1 + ${level2Count} Level 2).` }, { status: 400 });
    }

    const invalidDraw = attendanceRows.some((attendance) => {
      if (typeof attendance.drawn_number !== "number") return true;
      const level = attendanceLevel(attendance);
      return !drawSlotsForLevel(level, level1Count, level2Count, attendanceRows.length).includes(attendance.drawn_number);
    });
    if (invalidDraw) {
      return Response.json({ error: attendanceRows.length === 5 ? "Cần tất cả người tham gia chọn số 1–5 trước khi tạo lịch." : "Cần tất cả người tham gia chọn số đúng dải Level hiện tại trước khi tạo lịch." }, { status: 400 });
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
