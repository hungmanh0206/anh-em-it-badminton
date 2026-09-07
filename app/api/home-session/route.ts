import { recalculateEloIfAvailable } from "@/lib/elo/server";
import { ApiError, jsonError, requireUser } from "@/lib/supabase-admin";
import { isCheckinWindowOpenForDate, normalizeSessionDateKey, rescheduledOriginalDateKey, targetSessionDateKey } from "@/lib/session-dates";
import type { SupabaseClient } from "@supabase/supabase-js";

type Profile = {
  id: string;
  level: "1" | "2";
};

type PlaySession = {
  id: string;
  session_date: string;
  status: "draft" | "checked_in" | "drawn" | "scheduled" | "completed";
};

const vietnamNow = () => new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
const isTestFlowEnabled = () => process.env.ENABLE_TEST_FLOW === "true" || process.env.NEXT_PUBLIC_ENABLE_TEST_FLOW === "true";

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
    if (originalSession) {
      const { data: movedSession, error: moveError } = await admin
        .from("play_sessions")
        .update({ session_date: normalizedSessionDate })
        .eq("id", originalSession.id)
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

async function loadSessionPayload(request: Request, reset: boolean) {
  const { admin, user, profile } = await requireUser(request);
  if (reset && profile.role !== "admin") throw new ApiError(403, "Chỉ Admin được reset phiên Home.");

  const now = vietnamNow();
  const shouldUseLiveSession = reset || isTestFlowEnabled() || isCheckinWindowOpenForDate(now);
  if (!shouldUseLiveSession) return Response.json({ inactive: true, status: "draft" });

  const sessionDate = targetSessionDateKey(now);
  const session = await getOrCreateSession(admin, user.id, sessionDate);
  if (reset && session.status === "completed") {
    throw new ApiError(400, "Buổi này đã hoàn tất nên không reset dữ liệu lịch sử.");
  }

  if (reset) {
    const [{ error: matchesError }, { error: requestsError }, { error: attendancesError }, { error: sessionError }] = await Promise.all([
      admin.from("matches").delete().eq("session_id", session.id),
      admin.from("attendance_change_requests").delete().eq("session_id", session.id),
      admin.from("attendances").delete().eq("session_id", session.id),
      admin.from("play_sessions").update({ status: "draft", attendance_confirmed_at: null, draw_open_at: null, schedule_mode: null }).eq("id", session.id),
    ]);
    if (matchesError) throw matchesError;
    if (requestsError) throw requestsError;
    if (attendancesError) throw attendancesError;
    if (sessionError) throw sessionError;
    await recalculateEloIfAvailable(admin);
    session.status = "draft";
  }

  await ensureAttendanceRows(admin, session.id);

  const [{ data: refreshedSession, error: sessionError }, { data: attendances, error: attendanceError }] = await Promise.all([
    admin.from("play_sessions").select("status").eq("id", session.id).single(),
    admin.from("attendances").select("choice, drawn_number, level_at_time, profiles!attendances_member_id_fkey(username, full_name, level, role, description)").eq("session_id", session.id),
  ]);
  if (sessionError) throw sessionError;
  if (attendanceError) throw attendanceError;

  return Response.json({
    sessionId: session.id,
    sessionDate: session.session_date,
    status: refreshedSession?.status || session.status,
    attendances: attendances || [],
    reset,
  });
}

export async function GET(request: Request) {
  try {
    return await loadSessionPayload(request, false);
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { reset?: boolean };
    return await loadSessionPayload(request, Boolean(body.reset));
  } catch (error) {
    return jsonError(error);
  }
}
