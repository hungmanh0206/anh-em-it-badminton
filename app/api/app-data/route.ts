import { ApiError, jsonError, requireUser } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type SupabaseProfile = {
  id?: string;
  username?: string | null;
  full_name?: string | null;
  level?: number | string | null;
  role?: "admin" | "member" | string | null;
  is_active?: boolean | null;
};

type MonthlyResultRow = {
  month?: string | null;
  total_points: number;
  points_for: number;
  points_against: number;
  point_diff: number;
  matches_played: number;
  level_next_month: number | null;
  created_at?: string | null;
  profiles: SupabaseProfile | SupabaseProfile[] | null;
};

type RankingRow = {
  name: string;
  initials: string;
  level: number;
  points: number;
  pointsWon: number;
  pointsLost: number;
  pointDiff: number;
  matches: number;
  color: string;
  placeholder?: boolean;
};

type HistorySessionRow = {
  id: string;
  session_date: string;
  matches?: { count: number }[] | null;
  attendances?: { count?: number; choice?: string | null }[] | null;
};

const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;
const colorForIndex = (index: number) => ["#e7ad26", "#6ba9de", "#df8d2a", "#6846e8", "#e56a4d", "#2ba98b"][index % 6];
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const monthStartFromKey = (key: string) => {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, (month || 1) - 1, 1);
};
const monthLabel = (date: Date) => `Tháng ${date.getMonth() + 1}, ${date.getFullYear()}`;
const nextMonthStartDate = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 1);
const finalSaturdayOfMonth = (date: Date) => {
  const finalSaturday = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  while (finalSaturday.getDay() !== 6) finalSaturday.setDate(finalSaturday.getDate() - 1);
  return finalSaturday;
};
const recentMonthStarts = (start: Date, count: number) => Array.from({ length: count }, (_, index) => new Date(start.getFullYear(), start.getMonth() - index, 1));
const initialsFromName = (name: string) => name.split(" ").map((part) => part[0]).slice(-2).join("");
const profileFromJoin = (value: SupabaseProfile | SupabaseProfile[] | null | undefined) => Array.isArray(value) ? value[0] : value;

const sortMonthlyResultRows = (rows: MonthlyResultRow[]) => [...rows].sort((a, b) =>
  b.total_points - a.total_points ||
  b.point_diff - a.point_diff ||
  b.points_for - a.points_for ||
  a.matches_played - b.matches_played ||
  String(a.created_at || "").localeCompare(String(b.created_at || ""))
);

const rankingSort = (a: RankingRow, b: RankingRow) =>
  b.points - a.points ||
  b.pointDiff - a.pointDiff ||
  b.pointsWon - a.pointsWon ||
  a.matches - b.matches ||
  a.name.localeCompare(b.name, "vi");

function zeroRowsFromProfiles(profiles: SupabaseProfile[]) {
  return [...profiles]
    .sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || ""), "vi"))
    .map((profile, index) => {
      const name = profile.full_name || "Thành viên";
      return {
        name,
        initials: initialsFromName(name),
        level: Number(profile.level || 2),
        points: 0,
        pointsWon: 0,
        pointsLost: 0,
        pointDiff: 0,
        matches: 0,
        color: colorForIndex(index),
        placeholder: true,
      };
    });
}

function mapRows(rows: MonthlyResultRow[]) {
  return rows.map((row, index) => {
    const profile = profileFromJoin(row.profiles);
    const name = profile?.full_name || "Thành viên";
    return {
      username: profile?.username || name,
      name,
      initials: initialsFromName(name),
      level: Number(profile?.level || row.level_next_month || 2),
      points: row.total_points,
      pointsWon: row.points_for,
      pointsLost: row.points_against,
      pointDiff: row.point_diff,
      matches: row.matches_played,
      color: colorForIndex(index),
      placeholder: row.matches_played === 0,
    };
  });
}

function buildRankingRows(rows: MonthlyResultRow[], profiles: SupabaseProfile[]) {
  if (!profiles.length) return mapRows(sortMonthlyResultRows(rows));
  const sortedProfiles = [...profiles].sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || ""), "vi"));
  const hasMatchData = rows.some((row) => row.matches_played > 0);
  if (!hasMatchData) return zeroRowsFromProfiles(sortedProfiles);

  const rowsByUsername = new Map(rows.flatMap((row) => {
    const profile = profileFromJoin(row.profiles);
    return profile?.username ? [[profile.username, row] as const] : [];
  }));

  return sortedProfiles.map((profile, index) => {
    const row = profile.username ? rowsByUsername.get(profile.username) : undefined;
    const name = profile.full_name || "Thành viên";
    if (!row) {
      return {
        name,
        initials: initialsFromName(name),
        level: Number(profile.level || 2),
        points: 0,
        pointsWon: 0,
        pointsLost: 0,
        pointDiff: 0,
        matches: 0,
        color: colorForIndex(index),
        placeholder: true,
      };
    }
    return {
      name,
      initials: initialsFromName(name),
      level: Number(profile.level || row.level_next_month || 2),
      points: row.total_points,
      pointsWon: row.points_for,
      pointsLost: row.points_against,
      pointDiff: row.point_diff,
      matches: row.matches_played,
      color: colorForIndex(index),
      placeholder: row.matches_played === 0,
    };
  }).sort(rankingSort);
}

function requireDateKey(value: string | null, fallback: string, name: string) {
  const key = value || fallback;
  if (!dateKeyPattern.test(key)) throw new ApiError(400, `${name} không hợp lệ.`);
  return key;
}

export async function GET(request: Request) {
  try {
    const { admin } = await requireUser(request);
    const url = new URL(request.url);
    const fallbackMonth = dateKey(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    const month = requireDateKey(url.searchParams.get("month"), fallbackMonth, "Tháng");
    const currentMonthKey = requireDateKey(url.searchParams.get("currentMonth"), month, "Tháng hiện tại");
    const sessionMonthKey = requireDateKey(url.searchParams.get("sessionMonth"), currentMonthKey, "Tháng buổi chơi");
    const previousMonthKey = requireDateKey(url.searchParams.get("previousMonth"), dateKey(new Date(monthStartFromKey(currentMonthKey).getFullYear(), monthStartFromKey(currentMonthKey).getMonth() - 1, 1)), "Tháng trước");

    const selectedMonthDate = monthStartFromKey(month);
    const selectedNextMonthDate = nextMonthStartDate(selectedMonthDate);
    const selectedNextMonthKey = dateKey(selectedNextMonthDate);
    const selectedFinalSaturdayKey = dateKey(finalSaturdayOfMonth(selectedMonthDate));
    const championMonthDates = recentMonthStarts(monthStartFromKey(currentMonthKey), 12);
    const championMonthKeys = championMonthDates.map(dateKey);
    const championFinalSessionKeys = championMonthDates.map((date) => dateKey(finalSaturdayOfMonth(date)));
    const requestedRankingMonths = [...new Set([month, currentMonthKey, sessionMonthKey, previousMonthKey, ...championMonthKeys])];
    const rankingSelect = "month, total_points, points_for, points_against, point_diff, matches_played, level_next_month, created_at, profiles!monthly_results_member_id_fkey(username, full_name, level)";

    const [
      { data: allRankingData, error: rankingError },
      { data: championFinalSessions, error: championSessionError },
      { data: activeProfiles, error: profileError },
      { data: finalSession, error: finalSessionError },
      { count: nextMonthRows, error: nextMonthError },
      { data: historyData, error: historyError },
    ] = await Promise.all([
      admin.from("monthly_results").select(rankingSelect).in("month", requestedRankingMonths),
      admin.from("play_sessions").select("session_date, status").in("session_date", championFinalSessionKeys),
      admin.from("profiles").select("username, full_name, level").eq("is_active", true).order("full_name"),
      admin.from("play_sessions").select("status").eq("session_date", selectedFinalSaturdayKey).maybeSingle(),
      admin.from("monthly_results").select("id", { count: "exact", head: true }).eq("month", selectedNextMonthKey),
      admin.from("play_sessions").select("id, session_date, matches(count), attendances(choice)").eq("status", "completed").order("session_date", { ascending: false }),
    ]);

    const queryError = rankingError || championSessionError || profileError || finalSessionError || nextMonthError || historyError;
    if (queryError) throw queryError;

    const rankingRowsByMonth = new Map<string, MonthlyResultRow[]>();
    ((allRankingData || []) as MonthlyResultRow[]).forEach((row) => {
      if (!row.month) return;
      const rows = rankingRowsByMonth.get(row.month) ?? [];
      rows.push(row);
      rankingRowsByMonth.set(row.month, rows);
    });

    const activeProfileRows = (activeProfiles || []) as SupabaseProfile[];
    const selectedRows = rankingRowsByMonth.get(month) ?? [];
    const currentRowsForCalendarMonth = rankingRowsByMonth.get(currentMonthKey) ?? [];
    const liveRowsForSessionMonth = rankingRowsByMonth.get(sessionMonthKey) ?? [];
    const rankingRows = buildRankingRows(selectedRows, activeProfileRows);
    const currentRankingRows = buildRankingRows(currentRowsForCalendarMonth, activeProfileRows);
    const liveRankingRows = buildRankingRows(liveRowsForSessionMonth, activeProfileRows);
    const previousRankingRows = mapRows(sortMonthlyResultRows(rankingRowsByMonth.get(previousMonthKey) ?? []));

    let championRankingRows: RankingRow[] = [];
    let championRankingLabel = monthLabel(monthStartFromKey(previousMonthKey));
    const completedFinalSessionDates = new Set(((championFinalSessions || []) as { session_date: string; status: string | null }[])
      .filter((sessionRow) => sessionRow.status === "completed")
      .map((sessionRow) => sessionRow.session_date));
    const latestChampionMonth = championMonthDates.find((date) => {
      const championMonthKey = dateKey(date);
      const monthRows = rankingRowsByMonth.get(championMonthKey) ?? [];
      const hasRealRanking = monthRows.some((row) => row.matches_played > 0);
      const isPastMonth = championMonthKey < currentMonthKey;
      const finalSessionCompleted = completedFinalSessionDates.has(dateKey(finalSaturdayOfMonth(date)));
      return hasRealRanking && (isPastMonth || finalSessionCompleted);
    });
    if (latestChampionMonth) {
      const championMonthKey = dateKey(latestChampionMonth);
      championRankingRows = mapRows(sortMonthlyResultRows(rankingRowsByMonth.get(championMonthKey) ?? []));
      championRankingLabel = monthLabel(latestChampionMonth);
    }

    const historySessions = ((historyData || []) as HistorySessionRow[]).map((session) => {
      const attendanceRows = session.attendances || [];
      const attendees = attendanceRows.some((row) => typeof row.choice === "string")
        ? attendanceRows.filter((row) => row.choice === "attending").length
        : attendanceRows[0]?.count || 0;
      return {
        id: session.id,
        date: session.session_date,
        matches: session.matches?.[0]?.count || 0,
        attendees,
      };
    });

    const currentRows = selectedRows.length;
    const finalSessionCompleted = finalSession?.status === "completed";
    const closed = Boolean(nextMonthRows && nextMonthRows > 0);

    return Response.json({
      rankingRows,
      currentRankingRows,
      liveRankingRows,
      previousRankingRows,
      championRankingRows,
      championRankingLabel,
      historySessions,
      monthCloseStatus: {
        monthKey: month,
        monthLabel: monthLabel(selectedMonthDate),
        nextMonthKey: selectedNextMonthKey,
        nextMonthLabel: monthLabel(selectedNextMonthDate),
        finalSessionCompleted,
        closed,
        eligible: finalSessionCompleted && currentRows > 0 && !closed,
        currentRows,
        message: closed ? `Đã tạo BXH ${monthLabel(selectedNextMonthDate)}.` : !currentRows ? "Tháng này chưa có dữ liệu BXH để chốt." : !finalSessionCompleted ? "Buổi cuối tháng chưa hoàn tất nhập điểm." : "Sẵn sàng chốt BXH và tạo tháng mới.",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
