import { jsonError, requireAdmin } from "@/lib/supabase-admin";

type Body = {
  month?: string;
};

type Profile = {
  id: string;
  full_name: string;
  level: "1" | "2";
};

type MonthlyRow = {
  id?: string;
  member_id: string;
  rank: number;
  total_points: number;
  points_for: number;
  points_against: number;
  point_diff: number;
  matches_played: number;
  level_next_month: "1" | "2";
  created_at?: string;
};

const isMonthKey = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-01$/.test(value);
const toDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const nextMonthKey = (month: string) => {
  const date = new Date(`${month}T00:00:00`);
  return toDateKey(new Date(date.getFullYear(), date.getMonth() + 1, 1));
};
const finalSaturdayKey = (month: string) => {
  const date = new Date(`${month}T00:00:00`);
  const finalSaturday = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  while (finalSaturday.getDay() !== 6) finalSaturday.setDate(finalSaturday.getDate() - 1);
  return toDateKey(finalSaturday);
};
const emptyMonthlyRow = (month: string, memberId: string, level: "1" | "2") => ({
  month,
  member_id: memberId,
  rank: 999,
  total_points: 0,
  points_for: 0,
  points_against: 0,
  point_diff: 0,
  matches_played: 0,
  level_next_month: level,
});

export async function POST(request: Request) {
  try {
    const { admin } = await requireAdmin(request);
    const body = await request.json() as Body;
    if (!isMonthKey(body.month)) return Response.json({ error: "Tháng cần chốt không hợp lệ." }, { status: 400 });
    const month = body.month;
    const nextMonth = nextMonthKey(month);

    const { count: existingNextMonthCount, error: existingNextMonthError } = await admin
      .from("monthly_results")
      .select("id", { count: "exact", head: true })
      .eq("month", nextMonth);
    if (existingNextMonthError) throw existingNextMonthError;
    if ((existingNextMonthCount || 0) > 0) {
      return Response.json({ ok: true, alreadyClosed: true, nextMonth });
    }

    const { data: finalSession, error: finalSessionError } = await admin
      .from("play_sessions")
      .select("id, status")
      .eq("session_date", finalSaturdayKey(month))
      .maybeSingle();
    if (finalSessionError) throw finalSessionError;
    if (finalSession?.status !== "completed") {
      return Response.json({ error: "Buổi cuối tháng chưa hoàn tất nhập điểm nên chưa thể chốt BXH." }, { status: 400 });
    }

    const [{ data: profiles, error: profilesError }, { data: currentRows, error: currentRowsError }] = await Promise.all([
      admin.from("profiles").select("id, full_name, level").eq("is_active", true),
      admin.from("monthly_results").select("id, member_id, rank, total_points, points_for, points_against, point_diff, matches_played, level_next_month, created_at").eq("month", month),
    ]);
    if (profilesError) throw profilesError;
    if (currentRowsError) throw currentRowsError;

    const activeProfiles = (profiles || []) as Profile[];
    if (!activeProfiles.length) return Response.json({ error: "Chưa có thành viên hoạt động để tạo BXH tháng mới." }, { status: 400 });

    const rowsByMember = new Map(((currentRows || []) as MonthlyRow[]).map((row) => [row.member_id, row]));
    const missingRows = activeProfiles
      .filter((profile) => !rowsByMember.has(profile.id))
      .map((profile) => emptyMonthlyRow(month, profile.id, profile.level));
    if (missingRows.length) {
      const { error: insertMissingError } = await admin.from("monthly_results").insert(missingRows);
      if (insertMissingError) throw insertMissingError;
    }

    const normalizedRows: MonthlyRow[] = activeProfiles.map((profile) => rowsByMember.get(profile.id) || {
      member_id: profile.id,
      rank: 999,
      total_points: 0,
      points_for: 0,
      points_against: 0,
      point_diff: 0,
      matches_played: 0,
      level_next_month: profile.level,
      created_at: profile.full_name,
    });
    if (!normalizedRows.some((row) => row.matches_played > 0)) {
      return Response.json({ error: "BXH tháng này chưa có trận nào để chốt." }, { status: 400 });
    }

    const sortedRows = [...normalizedRows].sort((a, b) =>
      b.total_points - a.total_points ||
      b.point_diff - a.point_diff ||
      b.points_for - a.points_for ||
      b.matches_played - a.matches_played ||
      String(a.created_at || "").localeCompare(String(b.created_at || ""))
    );
    const assignments = sortedRows.map((row, index) => ({
      memberId: row.member_id,
      rank: index + 1,
      nextLevel: index < 4 ? "1" as const : "2" as const,
    }));

    for (const assignment of assignments) {
      const { error: updateMonthlyError } = await admin
        .from("monthly_results")
        .update({ rank: assignment.rank, level_next_month: assignment.nextLevel })
        .eq("month", month)
        .eq("member_id", assignment.memberId);
      if (updateMonthlyError) throw updateMonthlyError;

      const { error: updateProfileError } = await admin
        .from("profiles")
        .update({ level: assignment.nextLevel })
        .eq("id", assignment.memberId);
      if (updateProfileError) throw updateProfileError;
    }

    const nextMonthRows = assignments.map((assignment) => emptyMonthlyRow(nextMonth, assignment.memberId, assignment.nextLevel));
    const { error: createNextMonthError } = await admin
      .from("monthly_results")
      .upsert(nextMonthRows, { onConflict: "month,member_id" });
    if (createNextMonthError) throw createNextMonthError;

    return Response.json({ ok: true, month, nextMonth, promotedCount: 4, memberCount: assignments.length });
  } catch (error) {
    return jsonError(error);
  }
}
