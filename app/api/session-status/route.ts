import { jsonError, requireAdmin } from "@/lib/supabase-admin";

type Body = {
  sessionId?: string;
  status?: "scheduled";
};

type ProfileJoin = {
  level?: "1" | "2" | number | string | null;
};

type AttendanceWithProfile = {
  drawn_number: number | null;
  profiles: ProfileJoin | ProfileJoin[] | null;
};

const allowedLevel1CountsByParticipants = new Map<number, number[]>([
  [6, [0, 1, 2, 3, 4]],
  [7, [1, 2, 3, 4]],
  [8, [2, 3, 4]],
  [9, [3, 4]],
  [10, [4]],
]);
const toProfile = (profiles: ProfileJoin | ProfileJoin[] | null) => Array.isArray(profiles) ? profiles[0] : profiles;
const toLevel = (level: ProfileJoin["level"]): 1 | 2 => Number(level) === 1 ? 1 : 2;
const drawSlotsForLevel = (level: 1 | 2, level1Count: number, level2Count: number) => {
  const count = Math.max(0, level === 1 ? level1Count : level2Count);
  const start = level === 1 ? 1 : 5;
  return Array.from({ length: count }, (_, index) => start + index);
};
const hasScheduleScenario = (participantCount: number, level1Count: number) =>
  allowedLevel1CountsByParticipants.get(participantCount)?.includes(level1Count) ?? false;

export async function POST(request: Request) {
  try {
    const { admin } = await requireAdmin(request);
    const body = await request.json() as Body;
    if (!body.sessionId || body.status !== "scheduled") return Response.json({ error: "Trạng thái phiên không hợp lệ." }, { status: 400 });

    const { data: attendances, error: attendanceError } = await admin
      .from("attendances")
      .select("drawn_number, profiles!attendances_member_id_fkey(level)")
      .eq("session_id", body.sessionId)
      .eq("choice", "attending");
    if (attendanceError) throw attendanceError;
    const attendanceRows = (attendances || []) as AttendanceWithProfile[];
    if (!attendanceRows.length) return Response.json({ error: "Chưa có thành viên tham gia để tạo lịch." }, { status: 400 });

    const level1Count = attendanceRows.filter((attendance) => toLevel(toProfile(attendance.profiles)?.level) === 1).length;
    const level2Count = attendanceRows.length - level1Count;
    if (!hasScheduleScenario(attendanceRows.length, level1Count)) {
      return Response.json({ error: `Chưa có mẫu lịch phù hợp cho ${attendanceRows.length} người (${level1Count} Level 1 + ${level2Count} Level 2).` }, { status: 400 });
    }

    const invalidDraw = attendanceRows.some((attendance) => {
      if (typeof attendance.drawn_number !== "number") return true;
      const level = toLevel(toProfile(attendance.profiles)?.level);
      return !drawSlotsForLevel(level, level1Count, level2Count).includes(attendance.drawn_number);
    });
    if (invalidDraw) {
      return Response.json({ error: "Cần tất cả người tham gia bốc số đúng dải Level hiện tại trước khi tạo lịch." }, { status: 400 });
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
