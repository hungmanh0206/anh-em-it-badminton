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

const vietnamNow = () => new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const targetSaturdayKey = (now: Date) => {
  const date = new Date(now);
  date.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7));
  return dateKey(date);
};

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
    admin.from("attendances").select("choice, drawn_number, profiles!attendances_member_id_fkey(username, full_name, level, role)").eq("session_id", session.id),
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
    if (day < 3 || day > 6) {
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
    if (session.status === "completed") return Response.json({ error: "Buổi này đã hoàn tất nên không thể đổi điểm danh." }, { status: 400 });

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

    const { error: updateError } = await admin
      .from("attendances")
      .update({ choice: nextChoice, responded_at: new Date().toISOString() })
      .eq("session_id", session.id)
      .eq("member_id", user.id);
    if (updateError) throw updateError;

    const needsReset = ["drawn", "scheduled"].includes(session.status) && previousChoice !== nextChoice;
    if (needsReset) {
      const { error: requestError } = await admin
        .from("attendance_change_requests")
        .insert({
          session_id: session.id,
          member_id: user.id,
          previous_choice: previousChoice,
          requested_choice: nextChoice,
        });
      if (requestError) throw requestError;
    }

    const payload = await loadSessionPayload(admin, session);
    return Response.json({ ...payload, needsReset });
  } catch (error) {
    return jsonError(error);
  }
}
