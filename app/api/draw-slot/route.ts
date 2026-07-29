import { ApiError, jsonError, requireUser } from "@/lib/supabase-admin";

type Body = {
  sessionId?: string;
};

type ProfileJoin = {
  id?: string | null;
  username?: string | null;
  full_name?: string | null;
  level?: "1" | "2" | number | string | null;
};

type AttendanceWithProfile = {
  member_id: string;
  choice: "pending" | "attending" | "absent";
  drawn_number: number | null;
  profiles: ProfileJoin | ProfileJoin[] | null;
};

const openDrawStatuses = new Set(["checked_in", "drawn", "scheduled", "completed"]);
const allowedLevel1CountsByParticipants = new Map<number, number[]>([
  [5, [0, 1, 2, 3, 4, 5]],
  [6, [0, 1, 2, 3, 4]],
  [7, [1, 2, 3, 4]],
  [8, [2, 3, 4]],
  [9, [3, 4]],
  [10, [4]],
]);

const toProfile = (profiles: ProfileJoin | ProfileJoin[] | null) => Array.isArray(profiles) ? profiles[0] : profiles;
const toLevel = (level: ProfileJoin["level"]): 1 | 2 => Number(level) === 1 ? 1 : 2;
const hasScheduleScenario = (participantCount: number, level1Count: number) =>
  allowedLevel1CountsByParticipants.get(participantCount)?.includes(level1Count) ?? false;
const drawSlotsForLevel = (level: 1 | 2, level1Count: number, level2Count: number, participantCount = level1Count + level2Count) => {
  if (participantCount === 5) return [1, 2, 3, 4, 5];
  const count = Math.max(0, level === 1 ? level1Count : level2Count);
  const start = level === 1 ? 1 : 5;
  return Array.from({ length: count }, (_, index) => start + index);
};
const isDrawSlotValid = (level: 1 | 2, slot: number, level1Count: number, level2Count: number, participantCount = level1Count + level2Count) =>
  drawSlotsForLevel(level, level1Count, level2Count, participantCount).includes(slot);

const pickRandom = (items: number[]) => items[Math.floor(Math.random() * items.length)];

export async function POST(request: Request) {
  try {
    const { admin, user, profile } = await requireUser(request);
    const body = await request.json() as Body;
    if (!body.sessionId) return Response.json({ error: "Thiếu phiên thi đấu để chọn số." }, { status: 400 });

    const { data: sessionRow, error: sessionError } = await admin
      .from("play_sessions")
      .select("status")
      .eq("id", body.sessionId)
      .single();
    if (sessionError) throw sessionError;
    const sessionStatus = String(sessionRow?.status || "");
    if (!openDrawStatuses.has(sessionStatus)) {
      return Response.json({ error: "Bước chọn số chưa được mở cho buổi này." }, { status: 400 });
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data, error } = await admin
        .from("attendances")
        .select("member_id, choice, drawn_number, profiles!attendances_member_id_fkey(id, username, full_name, level)")
        .eq("session_id", body.sessionId);
      if (error) throw error;

      const attendances = (data || []) as AttendanceWithProfile[];
      const selfAttendance = attendances.find((attendance) => attendance.member_id === user.id);
      if (!selfAttendance) throw new ApiError(404, "Không tìm thấy điểm danh của bạn trong buổi này.");
      if (selfAttendance.choice !== "attending") {
        return Response.json({ error: "Bạn cần điểm danh tham gia trước khi chọn số." }, { status: 400 });
      }

      const attendingRows = attendances.filter((attendance) => attendance.choice === "attending");
      const participantCount = attendingRows.length;
      const level1Count = attendingRows.filter((attendance) => toLevel(toProfile(attendance.profiles)?.level) === 1).length;
      const level2Count = attendingRows.length - level1Count;
      if (!hasScheduleScenario(participantCount, level1Count)) {
        return Response.json({ error: participantCount < 5 ? "Cần tối thiểu 5 người tham gia để mở chọn số." : `Chưa có mẫu lịch phù hợp cho ${participantCount} người (${level1Count} Level 1 + ${level2Count} Level 2).` }, { status: 400 });
      }
      const selfLevel = toLevel(toProfile(selfAttendance.profiles)?.level ?? profile.level);
      const pool = drawSlotsForLevel(selfLevel, level1Count, level2Count, participantCount);
      if (!pool.length) return Response.json({ error: "Không có dải số phù hợp với Level của bạn trong buổi này." }, { status: 400 });

      const inactiveMemberIdsWithStaleSlots = attendances
        .filter((attendance) => attendance.choice !== "attending" && typeof attendance.drawn_number === "number")
        .map((attendance) => attendance.member_id);
      const invalidMemberIds = attendingRows
        .filter((attendance) => typeof attendance.drawn_number === "number")
        .filter((attendance) => {
          const attendanceLevel = toLevel(toProfile(attendance.profiles)?.level);
          return !isDrawSlotValid(attendanceLevel, Number(attendance.drawn_number), level1Count, level2Count, participantCount);
        })
        .map((attendance) => attendance.member_id);
      const memberIdsToClear = [...new Set([...inactiveMemberIdsWithStaleSlots, ...invalidMemberIds])];

      if (memberIdsToClear.length) {
        const { error: clearError } = await admin
          .from("attendances")
          .update({ drawn_number: null })
          .eq("session_id", body.sessionId)
          .in("member_id", memberIdsToClear);
        if (clearError) throw clearError;
        continue;
      }

      if (typeof selfAttendance.drawn_number === "number" && pool.includes(selfAttendance.drawn_number)) {
        return Response.json({ drawnNumber: selfAttendance.drawn_number, level: selfLevel, pool, autoAssigned: true });
      }

      const usedSlots = new Set(attendingRows
        .filter((attendance) => attendance.member_id !== user.id)
        .map((attendance) => attendance.drawn_number)
        .filter((slot): slot is number => typeof slot === "number"));
      const available = pool.filter((slot) => !usedSlots.has(slot));
      if (!available.length) return Response.json({ error: "Không còn số trống trong dải Level của bạn." }, { status: 409 });

      const autoAssigned = available.length === 1;
      const selected = autoAssigned ? available[0] : pickRandom(available);
      const { data: updatedAttendance, error: updateError } = await admin
        .from("attendances")
        .update({ drawn_number: selected, level_at_time: String(selfLevel) })
        .eq("session_id", body.sessionId)
        .eq("member_id", user.id)
        .eq("choice", "attending")
        .select("drawn_number")
        .single();

      if (updateError) {
        const message = updateError.message.toLowerCase();
        if (message.includes("duplicate") || message.includes("unique")) continue;
        throw updateError;
      }

      const normalizedRows = attendingRows.map((attendance) =>
        attendance.member_id === user.id ? { ...attendance, drawn_number: Number(updatedAttendance.drawn_number) } : attendance
      );
      const everyoneHasValidSlot = normalizedRows.every((attendance) => {
        const attendanceLevel = toLevel(toProfile(attendance.profiles)?.level);
        return typeof attendance.drawn_number === "number" && isDrawSlotValid(attendanceLevel, attendance.drawn_number, level1Count, level2Count, participantCount);
      });
      if (everyoneHasValidSlot) {
        const { error: statusError } = await admin
          .from("play_sessions")
          .update({ status: "drawn" })
          .eq("id", body.sessionId)
          .eq("status", "checked_in");
        if (statusError) throw statusError;
      }

      return Response.json({ drawnNumber: Number(updatedAttendance.drawn_number), level: selfLevel, pool, autoAssigned });
    }

    return Response.json({ error: "Có người vừa bốc cùng lúc. Bạn thử lại một lần nữa nhé." }, { status: 409 });
  } catch (error) {
    return jsonError(error);
  }
}
