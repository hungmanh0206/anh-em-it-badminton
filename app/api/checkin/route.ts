import { ApiError, jsonError, requireUser } from "@/lib/supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";

type Body = {
  attending?: boolean;
  sessionId?: string | null;
};

type Profile = {
  id: string;
  level: "1" | "2";
};

type PlaySession = {
  id: string;
  session_date: string;
  status: "draft" | "checked_in" | "drawn" | "scheduled" | "completed";
};

type ProfileJoin = {
  level?: "1" | "2" | number | string | null;
  is_active?: boolean | null;
};

type AttendanceStatusRow = {
  choice: "pending" | "attending" | "absent";
  level_at_time?: "1" | "2" | number | string | null;
  profiles: ProfileJoin | ProfileJoin[] | null;
};

type StoredMatch = {
  team_a: string[];
  team_b: string[];
  score_a: number | null;
  score_b: number | null;
};

type MonthlyResult = {
  id: string;
  rank: number;
  total_points: number;
  points_for: number;
  points_against: number;
  point_diff: number;
  matches_played: number;
  level_next_month: "1" | "2";
};

const vietnamNow = () => new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const targetSaturdayKey = (now: Date) => {
  const date = new Date(now);
  date.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7));
  return dateKey(date);
};
const isTestFlowEnabled = () => process.env.ENABLE_TEST_FLOW === "true" || process.env.NEXT_PUBLIC_ENABLE_TEST_FLOW === "true";
const monthStart = (dateText: string) => {
  const date = new Date(`${dateText}T00:00:00`);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
};
const nextMonthStart = (dateText: string) => {
  const date = new Date(`${dateText}T00:00:00`);
  return `${date.getFullYear()}-${String(date.getMonth() + 2).padStart(2, "0")}-01`;
};
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
const attendanceLevel = (attendance: AttendanceStatusRow): 1 | 2 =>
  toLevel(attendance.level_at_time ?? toProfile(attendance.profiles)?.level);
const hasScheduleScenario = (participantCount: number, level1Count: number) =>
  allowedLevel1CountsByParticipants.get(participantCount)?.includes(level1Count) ?? false;

async function rerankMonthlyResults(admin: SupabaseClient, month: string) {
  const { error: zeroRankError } = await admin
    .from("monthly_results")
    .update({ rank: 999 })
    .eq("month", month)
    .eq("matches_played", 0);
  if (zeroRankError) throw zeroRankError;

  const { data: rankRows, error: rankError } = await admin
    .from("monthly_results")
    .select("id, total_points, points_for, point_diff, matches_played, created_at")
    .eq("month", month)
    .gt("matches_played", 0);
  if (rankError) throw rankError;

  const sortedRows = [...(rankRows || [])].sort((a, b) =>
    b.total_points - a.total_points ||
    b.point_diff - a.point_diff ||
    b.points_for - a.points_for ||
    a.matches_played - b.matches_played ||
    String(a.created_at).localeCompare(String(b.created_at))
  );
  for (const [index, row] of sortedRows.entries()) {
    const { error: updateRankError } = await admin
      .from("monthly_results")
      .update({ rank: index + 1 })
      .eq("id", row.id);
    if (updateRankError) throw updateRankError;
  }
}

async function assertSessionResultsAreReversible(admin: SupabaseClient, session: PlaySession) {
  const { count: scoredMatchCount, error: scoredMatchError } = await admin
    .from("matches")
    .select("id", { count: "exact", head: true })
    .eq("session_id", session.id)
    .not("score_a", "is", null)
    .not("score_b", "is", null);
  if (scoredMatchError) throw scoredMatchError;
  if (!scoredMatchCount) return;

  const { count: nextMonthCount, error: nextMonthError } = await admin
    .from("monthly_results")
    .select("id", { count: "exact", head: true })
    .eq("month", nextMonthStart(session.session_date));
  if (nextMonthError) throw nextMonthError;
  if ((nextMonthCount || 0) > 0) {
    throw new ApiError(400, "Tháng này đã chốt BXH nên không thể đổi điểm danh làm thay đổi kết quả đã lưu.");
  }
}

async function reverseSessionResults(admin: SupabaseClient, session: PlaySession) {
  const { data: matches, error: matchesError } = await admin
    .from("matches")
    .select("team_a, team_b, score_a, score_b")
    .eq("session_id", session.id);
  if (matchesError) throw matchesError;

  const storedMatches = ((matches || []) as StoredMatch[]).filter((match) =>
    typeof match.score_a === "number" && typeof match.score_b === "number"
  );
  if (!storedMatches.length) return;

  const month = monthStart(session.session_date);
  const participantIds = [...new Set(storedMatches.flatMap((match) => [...match.team_a, ...match.team_b]))];
  const { data: profiles, error: profilesError } = await admin
    .from("profiles")
    .select("id, level")
    .in("id", participantIds);
  if (profilesError) throw profilesError;
  const levels = new Map(((profiles || []) as { id: string; level: "1" | "2" }[]).map((profile) => [profile.id, profile.level]));

  const adjustMonthlyResult = async (memberId: string, delta: { total: number; for: number; against: number; matches: number }) => {
    const { data: existing, error: readError } = await admin
      .from("monthly_results")
      .select("id, rank, total_points, points_for, points_against, point_diff, matches_played, level_next_month")
      .eq("month", month)
      .eq("member_id", memberId)
      .maybeSingle();
    if (readError) throw readError;
    const base = existing as MonthlyResult | null;
    if (!base) {
      const { error: insertError } = await admin.from("monthly_results").insert({
        month,
        member_id: memberId,
        rank: 999,
        total_points: 0,
        points_for: 0,
        points_against: 0,
        point_diff: 0,
        matches_played: 0,
        level_next_month: levels.get(memberId) || "2",
      });
      if (insertError) throw insertError;
    }
    const current = base || { rank: 999, total_points: 0, points_for: 0, points_against: 0, matches_played: 0, level_next_month: levels.get(memberId) || "2" };
    const pointsFor = Math.max(0, current.points_for + delta.for);
    const pointsAgainst = Math.max(0, current.points_against + delta.against);
    const matchesPlayed = Math.max(0, current.matches_played + delta.matches);
    const { error: updateError } = await admin
      .from("monthly_results")
      .update({
        rank: matchesPlayed > 0 ? current.rank : 999,
        total_points: Math.max(0, current.total_points + delta.total),
        points_for: pointsFor,
        points_against: pointsAgainst,
        point_diff: pointsFor - pointsAgainst,
        matches_played: matchesPlayed,
        level_next_month: current.level_next_month,
      })
      .eq("month", month)
      .eq("member_id", memberId);
    if (updateError) throw updateError;
  };

  for (const match of storedMatches) {
    const aWon = Number(match.score_a) > Number(match.score_b);
    for (const memberId of match.team_a) {
      await adjustMonthlyResult(memberId, { total: aWon ? -1 : 0, for: -Number(match.score_a), against: -Number(match.score_b), matches: -1 });
    }
    for (const memberId of match.team_b) {
      await adjustMonthlyResult(memberId, { total: aWon ? 0 : -1, for: -Number(match.score_b), against: -Number(match.score_a), matches: -1 });
    }
  }

  await rerankMonthlyResults(admin, month);
}

async function resetWorkflowAfterAttendanceChange(admin: SupabaseClient, session: PlaySession) {
  await reverseSessionResults(admin, session);

  const [{ error: matchesDeleteError }, { error: drawResetError }, { error: requestCleanupError }] = await Promise.all([
    admin.from("matches").delete().eq("session_id", session.id),
    admin.from("attendances").update({ drawn_number: null }).eq("session_id", session.id),
    admin.from("attendance_change_requests").delete().eq("session_id", session.id),
  ]);
  if (matchesDeleteError) throw matchesDeleteError;
  if (drawResetError) throw drawResetError;
  if (requestCleanupError) throw requestCleanupError;

  const { data: attendances, error: attendanceError } = await admin
    .from("attendances")
    .select("choice, level_at_time, profiles!attendances_member_id_fkey(level, is_active)")
    .eq("session_id", session.id);
  if (attendanceError) throw attendanceError;

  const activeRows = ((attendances || []) as AttendanceStatusRow[])
    .filter((attendance) => toProfile(attendance.profiles)?.is_active !== false);
  const attendingRows = activeRows.filter((attendance) => attendance.choice === "attending");
  const level1Count = attendingRows.filter((attendance) => attendanceLevel(attendance) === 1).length;
  const allResponded = activeRows.length > 0 && activeRows.every((attendance) => attendance.choice !== "pending");
  const canOpenDraw = allResponded && hasScheduleScenario(attendingRows.length, level1Count);
  const nextStatus = canOpenDraw ? "checked_in" : "draft";
  const nowText = new Date().toISOString();
  const { error: sessionError } = await admin
    .from("play_sessions")
    .update(canOpenDraw
      ? { status: nextStatus, attendance_confirmed_at: nowText, draw_open_at: nowText, schedule_mode: null }
      : { status: nextStatus, attendance_confirmed_at: null, draw_open_at: null, schedule_mode: null })
    .eq("id", session.id);
  if (sessionError) throw sessionError;
  session.status = nextStatus;
}

async function getOrCreateSession(admin: SupabaseClient, userId: string, sessionDate: string) {
  const { data: existing, error: existingError } = await admin
    .from("play_sessions")
    .select("id, session_date, status")
    .eq("session_date", sessionDate)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing as PlaySession;

  const { data: created, error: createError } = await admin
    .from("play_sessions")
    .insert({ session_date: sessionDate, created_by: userId })
    .select("id, session_date, status")
    .single();
  if (createError) {
    const { data: raced, error: racedError } = await admin
      .from("play_sessions")
      .select("id, session_date, status")
      .eq("session_date", sessionDate)
      .single();
    if (racedError) throw createError;
    return raced as PlaySession;
  }
  return created as PlaySession;
}

async function ensureAttendanceRows(admin: SupabaseClient, sessionId: string) {
  const { data: profiles, error: profilesError } = await admin
    .from("profiles")
    .select("id, level")
    .eq("is_active", true);
  if (profilesError) throw profilesError;

  const rows = ((profiles || []) as Profile[]).map((profile) => ({
    session_id: sessionId,
    member_id: profile.id,
    choice: "pending",
    level_at_time: profile.level,
  }));
  if (!rows.length) return;

  const { error } = await admin
    .from("attendances")
    .upsert(rows, { onConflict: "session_id,member_id", ignoreDuplicates: true });
  if (error) throw error;
}

async function loadSessionPayload(admin: SupabaseClient, session: PlaySession) {
  const [{ data: refreshedSession, error: sessionError }, { data: attendances, error: attendanceError }] = await Promise.all([
    admin.from("play_sessions").select("status").eq("id", session.id).single(),
    admin.from("attendances").select("choice, drawn_number, profiles!attendances_member_id_fkey(username, full_name, level, role, description)").eq("session_id", session.id),
  ]);
  if (sessionError) throw sessionError;
  if (attendanceError) throw attendanceError;

  return {
    sessionId: session.id,
    sessionDate: session.session_date,
    status: refreshedSession?.status || session.status,
    attendances: attendances || [],
  };
}

export async function POST(request: Request) {
  try {
    const { admin, user } = await requireUser(request);
    const body = await request.json().catch(() => ({})) as Body;
    if (typeof body.attending !== "boolean") return Response.json({ error: "Thiếu lựa chọn điểm danh." }, { status: 400 });

    const now = vietnamNow();
    const day = now.getDay();
    if (!isTestFlowEnabled() && (day < 3 || day > 6)) {
      return Response.json({ error: "Điểm danh chỉ mở từ thứ Tư đến thứ Bảy cho buổi chơi tuần này." }, { status: 400 });
    }

    let session: PlaySession | null = null;
    if (body.sessionId) {
      const { data, error } = await admin
        .from("play_sessions")
        .select("id, session_date, status")
        .eq("id", body.sessionId)
        .single();
      if (error) throw error;
      session = data as PlaySession;
    } else {
      session = await getOrCreateSession(admin, user.id, targetSaturdayKey(now));
    }
    if (!session) throw new ApiError(404, "Không tìm thấy phiên điểm danh.");

    await ensureAttendanceRows(admin, session.id);

    const { data: currentAttendance, error: currentError } = await admin
      .from("attendances")
      .select("choice")
      .eq("session_id", session.id)
      .eq("member_id", user.id)
      .single();
    if (currentError) throw currentError;

    const nextChoice = body.attending ? "attending" : "absent";
    const previousChoice = String(currentAttendance?.choice || "pending");
    const needsReset = ["checked_in", "drawn", "scheduled", "completed"].includes(session.status) && previousChoice !== nextChoice;

    if (needsReset) await assertSessionResultsAreReversible(admin, session);

    const { error: updateError } = await admin
      .from("attendances")
      .update({ choice: nextChoice, responded_at: new Date().toISOString() })
      .eq("session_id", session.id)
      .eq("member_id", user.id);
    if (updateError) throw updateError;

    if (needsReset) await resetWorkflowAfterAttendanceChange(admin, session);

    const payload = await loadSessionPayload(admin, session);
    return Response.json({ ...payload, needsReset });
  } catch (error) {
    return jsonError(error);
  }
}
