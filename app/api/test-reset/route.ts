import { ApiError, jsonError, requireAdmin } from "@/lib/supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";

type Profile = {
  id: string;
  level: "1" | "2";
};

type PlaySession = {
  id: string;
  session_date: string;
};

type Body = {
  sessionDate?: string;
  resetMonthly?: boolean;
};

const vietnamNow = () => new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const targetSaturdayKey = (now: Date) => {
  const date = new Date(now);
  date.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7));
  return dateKey(date);
};
const monthStart = (dateText: string) => {
  const date = new Date(`${dateText}T00:00:00`);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
};
const isDateKey = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isTestFlowEnabled = () => process.env.ENABLE_TEST_FLOW === "true" || process.env.NEXT_PUBLIC_ENABLE_TEST_FLOW === "true";

async function getOrCreateSession(admin: SupabaseClient, userId: string, sessionDate: string) {
  const { data: existing, error: existingError } = await admin
    .from("play_sessions")
    .select("id, session_date")
    .eq("session_date", sessionDate)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing as PlaySession;

  const { data: created, error: createError } = await admin
    .from("play_sessions")
    .insert({ session_date: sessionDate, created_by: userId })
    .select("id, session_date")
    .single();
  if (createError) throw createError;
  return created as PlaySession;
}

async function resetAttendanceRows(admin: SupabaseClient, sessionId: string) {
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
    drawn_number: null,
    responded_at: null,
  }));
  if (!rows.length) return 0;

  const { error: upsertError } = await admin
    .from("attendances")
    .upsert(rows, { onConflict: "session_id,member_id" });
  if (upsertError) throw upsertError;

  const { error: resetError } = await admin
    .from("attendances")
    .update({ choice: "pending", drawn_number: null, responded_at: null })
    .eq("session_id", sessionId);
  if (resetError) throw resetError;

  return rows.length;
}

export async function POST(request: Request) {
  try {
    if (!isTestFlowEnabled()) throw new ApiError(404, "Không tìm thấy chức năng này.");

    const { admin, user } = await requireAdmin(request);
    const body = await request.json().catch(() => ({})) as Body;
    const sessionDate = isDateKey(body.sessionDate) ? body.sessionDate : targetSaturdayKey(vietnamNow());
    const session = await getOrCreateSession(admin, user.id, sessionDate);
    const shouldResetMonthly = body.resetMonthly !== false;

    const [{ error: matchesError }, { error: requestsError }] = await Promise.all([
      admin.from("matches").delete().eq("session_id", session.id),
      admin.from("attendance_change_requests").delete().eq("session_id", session.id),
    ]);
    if (matchesError) throw matchesError;
    if (requestsError) throw requestsError;

    const attendanceRows = await resetAttendanceRows(admin, session.id);

    const { error: sessionError } = await admin
      .from("play_sessions")
      .update({ status: "draft", attendance_confirmed_at: null, draw_open_at: null, schedule_mode: null })
      .eq("id", session.id);
    if (sessionError) throw sessionError;

    if (shouldResetMonthly) {
      const { error: monthlyError } = await admin
        .from("monthly_results")
        .delete()
        .eq("month", monthStart(sessionDate));
      if (monthlyError) throw monthlyError;
    }

    return Response.json({
      ok: true,
      sessionDate,
      status: "draft",
      attendanceRows,
      resetMonthly: shouldResetMonthly,
    });
  } catch (error) {
    return jsonError(error);
  }
}
