import { recalculateEloIfAvailable } from "@/lib/elo/server";
import { buildDrawReassignmentPlan } from "@/lib/draw-reassign";
import { monthStart, nextMonthStart, sessionHasResults, syncMonthlyResults } from "@/lib/match-result";
import { ApiError, jsonError, requireUser } from "@/lib/supabase-admin";
import { isCheckinWindowOpenForDate, normalizeSessionDateKey, rescheduledOriginalDateKey, targetSessionDateKey } from "@/lib/session-dates";
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
  member_id: string;
  choice: "pending" | "attending" | "absent";
  drawn_number: number | null;
  level_at_time?: "1" | "2" | number | string | null;
  profiles: ProfileJoin | ProfileJoin[] | null;
};

const vietnamNow = () => new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
const isTestFlowEnabled = () => process.env.ENABLE_TEST_FLOW === "true" || process.env.NEXT_PUBLIC_ENABLE_TEST_FLOW === "true";
const toProfile = (profiles: ProfileJoin | ProfileJoin[] | null) => Array.isArray(profiles) ? profiles[0] : profiles;
const toLevel = (level: ProfileJoin["level"]): 1 | 2 => Number(level) === 1 ? 1 : 2;
const attendanceLevel = (attendance: AttendanceStatusRow): 1 | 2 =>
  toLevel(attendance.level_at_time ?? toProfile(attendance.profiles)?.level);

async function assertSessionResultsAreReversible(admin: SupabaseClient, session: PlaySession) {
  const [{ count: scoredMatchCount, error: scoredMatchError }, { count: nextMonthCount, error: nextMonthError }] = await Promise.all([
    admin
      .from("matches")
      .select("id", { count: "exact", head: true })
      .eq("session_id", session.id)
      .not("score_a", "is", null)
      .not("score_b", "is", null),
    admin
      .from("monthly_results")
      .select("id", { count: "exact", head: true })
      .eq("month", nextMonthStart(session.session_date)),
  ]);
  if (scoredMatchError) throw scoredMatchError;
  if (!scoredMatchCount) return;
  if (nextMonthError) throw nextMonthError;
  if ((nextMonthCount || 0) > 0) {
    throw new ApiError(400, "Tháng này đã chốt BXH nên không thể đổi điểm danh làm thay đổi kết quả đã lưu.");
  }
}

async function resetWorkflowAfterAttendanceChange(admin: SupabaseClient, session: PlaySession) {
  const scheduleWasOpen = session.status === "scheduled" || session.status === "completed";
  const { data: attendanceSnapshot, error: attendanceSnapshotError } = await admin
    .from("attendances")
    .select("member_id, choice, drawn_number, level_at_time, profiles!attendances_member_id_fkey(level, is_active)")
    .eq("session_id", session.id);
  if (attendanceSnapshotError) throw attendanceSnapshotError;

  const attendanceRows = (attendanceSnapshot || []) as AttendanceStatusRow[];
  const activeRows = attendanceRows.filter((attendance) => toProfile(attendance.profiles)?.is_active !== false);
  const allResponded = activeRows.length > 0 && activeRows.every((attendance) => attendance.choice !== "pending");
  const reassignmentPlan = buildDrawReassignmentPlan(attendanceRows.map((attendance) => ({
    memberId: attendance.member_id,
    choice: attendance.choice,
    level: attendance.level_at_time ?? toProfile(attendance.profiles)?.level,
    drawnNumber: attendance.drawn_number,
    isActive: toProfile(attendance.profiles)?.is_active !== false,
  })), { assignAll: scheduleWasOpen });
  const canOpenDraw = allResponded && reassignmentPlan.canOpenDraw;

  const hadResults = await sessionHasResults(admin, session.id);
  const [{ error: matchesDeleteError }, { error: requestCleanupError }] = await Promise.all([
    admin.from("matches").delete().eq("session_id", session.id),
    admin.from("attendance_change_requests").delete().eq("session_id", session.id),
  ]);
  if (matchesDeleteError) throw matchesDeleteError;
  if (requestCleanupError) throw requestCleanupError;
  if (hadResults) await syncMonthlyResults(admin, monthStart(session.session_date));
  const eloRecalculation = recalculateEloIfAvailable(admin);

  const memberIdsToClear = canOpenDraw
    ? reassignmentPlan.clearMemberIds
    : attendanceRows.filter((attendance) => typeof attendance.drawn_number === "number").map((attendance) => attendance.member_id);
  if (memberIdsToClear.length) {
    const { error: clearError } = await admin
      .from("attendances")
      .update({ drawn_number: null })
      .eq("session_id", session.id)
      .in("member_id", memberIdsToClear);
    if (clearError) throw clearError;
  }

  if (canOpenDraw) {
    // Numbers were cleared above and each assignment targets a different member and number.
    const assignResults = await Promise.all(reassignmentPlan.assignments.map((assignment: { memberId: string; drawnNumber: number; level: 1 | 2 }) => admin
      .from("attendances")
      .update({ drawn_number: assignment.drawnNumber, level_at_time: String(assignment.level) })
      .eq("session_id", session.id)
      .eq("member_id", assignment.memberId)
      .eq("choice", "attending")));
    const failedAssign = assignResults.find((result) => result.error);
    if (failedAssign?.error) throw failedAssign.error;
  }

  const nextStatus = !canOpenDraw ? "draft" : scheduleWasOpen && reassignmentPlan.allDrawn ? "scheduled" : reassignmentPlan.allDrawn ? "drawn" : "checked_in";
  const nowText = new Date().toISOString();
  const sessionUpdate = nextStatus === "draft"
    ? { status: nextStatus, attendance_confirmed_at: null, draw_open_at: null, schedule_mode: null }
    : nextStatus === "scheduled"
      ? { status: nextStatus, attendance_confirmed_at: nowText, draw_open_at: nowText, schedule_mode: "level_based" }
      : { status: nextStatus, attendance_confirmed_at: nowText, draw_open_at: nowText, schedule_mode: null };
  const { error: sessionError } = await admin
    .from("play_sessions")
    .update(sessionUpdate)
    .eq("id", session.id);
  if (sessionError) throw sessionError;
  await eloRecalculation;
  session.status = nextStatus;
  return {
    drawsReassigned: canOpenDraw && reassignmentPlan.assignments.length > 0,
    scheduleCleared: scheduleWasOpen,
    needsReset: !canOpenDraw,
  };
}

async function getOrCreateSession(admin: SupabaseClient, userId: string, sessionDate: string) {
  const normalizedSessionDate = normalizeSessionDateKey(sessionDate);
  const { data: existing, error: existingError } = await admin
    .from("play_sessions")
    .select("id, session_date, status")
    .eq("session_date", normalizedSessionDate)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing as PlaySession;

  const originalDate = rescheduledOriginalDateKey(normalizedSessionDate);
  if (originalDate) {
    const { data: originalSession, error: originalError } = await admin
      .from("play_sessions")
      .select("id, session_date, status")
      .eq("session_date", originalDate)
      .maybeSingle();
    if (originalError) throw originalError;
    if (originalSession) return await moveSessionToDate(admin, originalSession as PlaySession, normalizedSessionDate);
  }

  const { data: created, error: createError } = await admin
    .from("play_sessions")
    .insert({ session_date: normalizedSessionDate, created_by: userId })
    .select("id, session_date, status")
    .single();
  if (createError) {
    const { data: raced, error: racedError } = await admin
      .from("play_sessions")
      .select("id, session_date, status")
      .eq("session_date", normalizedSessionDate)
      .single();
    if (racedError) throw createError;
    return raced as PlaySession;
  }
  return created as PlaySession;
}

async function moveSessionToDate(admin: SupabaseClient, session: PlaySession, sessionDate: string) {
  const normalizedSessionDate = normalizeSessionDateKey(sessionDate);
  if (session.session_date === normalizedSessionDate) return session;

  const { data: movedSession, error: moveError } = await admin
    .from("play_sessions")
    .update({ session_date: normalizedSessionDate })
    .eq("id", session.id)
    .select("id, session_date, status")
    .single();
  if (!moveError && movedSession) return movedSession as PlaySession;

  const { data: raced, error: racedError } = await admin
    .from("play_sessions")
    .select("id, session_date, status")
    .eq("session_date", normalizedSessionDate)
    .maybeSingle();
  if (racedError || !raced) throw moveError;
  return raced as PlaySession;
}

// Creates missing pending rows for active members and returns the member ids that have a row in this session.
async function ensureAttendanceRows(admin: SupabaseClient, sessionId: string) {
  const [{ data: profiles, error: profilesError }, { data: attendances, error: attendancesError }] = await Promise.all([
    admin.from("profiles").select("id, level").eq("is_active", true),
    admin.from("attendances").select("member_id, choice").eq("session_id", sessionId),
  ]);
  if (profilesError) throw profilesError;
  if (attendancesError) throw attendancesError;

  const choiceByMember = new Map(((attendances || []) as { member_id: string; choice: string }[]).map((row) => [row.member_id, row.choice]));
  const rows = ((profiles || []) as Profile[])
    .filter((profile) => !choiceByMember.has(profile.id))
    .map((profile) => ({
      session_id: sessionId,
      member_id: profile.id,
      choice: "pending",
      level_at_time: profile.level,
    }));
  if (rows.length) {
    const { error } = await admin
      .from("attendances")
      .upsert(rows, { onConflict: "session_id,member_id", ignoreDuplicates: true });
    if (error) throw error;
    rows.forEach((row) => choiceByMember.set(row.member_id, row.choice));
  }
  return choiceByMember;
}

async function loadSessionPayload(admin: SupabaseClient, session: PlaySession) {
  const [{ data: refreshedSession, error: sessionError }, { data: attendances, error: attendanceError }] = await Promise.all([
    admin.from("play_sessions").select("status").eq("id", session.id).single(),
    admin.from("attendances").select("choice, drawn_number, level_at_time, profiles!attendances_member_id_fkey(username, full_name, level, role, description)").eq("session_id", session.id),
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
    const { admin, user, profile } = await requireUser(request);
    const body = await request.json().catch(() => ({})) as Body;
    if (typeof body.attending !== "boolean") return Response.json({ error: "Thiếu lựa chọn điểm danh." }, { status: 400 });

    const now = vietnamNow();
    if (!isTestFlowEnabled() && !isCheckinWindowOpenForDate(now)) {
      return Response.json({ error: "Điểm danh chỉ mở từ thứ Tư đến hết ngày thi đấu của tuần này." }, { status: 400 });
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
      session = await moveSessionToDate(admin, session, normalizeSessionDateKey(session.session_date));
    } else {
      session = await getOrCreateSession(admin, user.id, targetSessionDateKey(now));
    }
    if (!session) throw new ApiError(404, "Không tìm thấy phiên điểm danh.");

    const choiceByMember = await ensureAttendanceRows(admin, session.id);
    const currentChoice = choiceByMember.get(user.id);
    if (currentChoice === undefined) throw new ApiError(404, "Không tìm thấy điểm danh của bạn trong buổi này.");

    const nextChoice = body.attending ? "attending" : "absent";
    const previousChoice = String(currentChoice || "pending");
    const workflowNeedsResync = ["checked_in", "drawn", "scheduled", "completed"].includes(session.status) && previousChoice !== nextChoice;

    if (workflowNeedsResync) await assertSessionResultsAreReversible(admin, session);

    const { error: updateError } = await admin
      .from("attendances")
      .update({ choice: nextChoice, responded_at: new Date().toISOString(), level_at_time: String(toLevel(profile.level)) })
      .eq("session_id", session.id)
      .eq("member_id", user.id);
    if (updateError) throw updateError;

    const resync = workflowNeedsResync
      ? await resetWorkflowAfterAttendanceChange(admin, session)
      : { drawsReassigned: false, scheduleCleared: false, needsReset: false };

    const payload = await loadSessionPayload(admin, session);
    return Response.json({ ...payload, ...resync });
  } catch (error) {
    return jsonError(error);
  }
}
