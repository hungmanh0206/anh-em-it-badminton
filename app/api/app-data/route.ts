import { ELO_INITIAL_RATING } from "@/lib/elo/constants";
import { rankEloPlayers, replayEloMatches } from "@/lib/elo/calculate-elo";
import { isMissingEloFeature } from "@/lib/elo/server";
import { ApiError, jsonError, requireUser } from "@/lib/supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";

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

type EloRankingRow = {
  memberId: string;
  username: string;
  name: string;
  initials: string;
  level: number;
  eloRating: number;
  rank: number;
  matches: number;
  color: string;
};

type EloStatus = {
  source: "database" | "calculated" | "unavailable";
  processedMatches: number;
  message: string;
};

type EloRatingRow = { member_id: string; elo_rating: number | string | null; updated_at?: string | null };
type EloStoredMatch = { id: string; match_no: number; team_a: string[] | null; team_b: string[] | null; score_a: number | null; score_b: number | null };
type EloSessionRow = { session_date: string; matches?: EloStoredMatch[] | null };


type HistoryMatchSummary = {
  count?: number | null;
  team_a?: string[] | null;
  team_b?: string[] | null;
};

type HistorySessionRow = {
  id: string;
  session_date: string;
  matches?: HistoryMatchSummary[] | null;
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
const matchCountFromHistoryRows = (matches: HistoryMatchSummary[] | null | undefined) => {
  const rows = matches || [];
  if (rows.length === 1 && typeof rows[0].count === "number" && !rows[0].team_a && !rows[0].team_b) return rows[0].count || 0;
  return rows.length;
};
const attendeeCountFromMatches = (matches: HistoryMatchSummary[] | null | undefined) => {
  const memberIds = new Set<string>();
  (matches || []).forEach((match) => {
    [...(match.team_a || []), ...(match.team_b || [])].forEach((memberId) => {
      if (memberId) memberIds.add(memberId);
    });
  });
  return memberIds.size;
};
const attendeeCountFromAttendances = (attendances: HistorySessionRow["attendances"]) => {
  const rows = attendances || [];
  return rows.some((row) => typeof row.choice === "string")
    ? rows.filter((row) => row.choice === "attending").length
    : rows[0]?.count || 0;
};

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

const isScoredEloMatch = (match: EloStoredMatch) =>
  Array.isArray(match.team_a) &&
  Array.isArray(match.team_b) &&
  match.team_a.length === 2 &&
  match.team_b.length === 2 &&
  typeof match.score_a === "number" &&
  typeof match.score_b === "number" &&
  match.score_a !== match.score_b;

const buildEloRows = (rankedRows: Array<{ memberId: string; name?: string; username?: string; eloRating: number; rank: number; level: number; matches?: number }>, activeProfiles: SupabaseProfile[]): EloRankingRow[] => {
  const profileById = new Map(activeProfiles.flatMap((profile) => profile.id ? [[profile.id, profile] as const] : []));
  return rankedRows
    .filter((row) => profileById.has(row.memberId))
    .map((row, index) => {
      const profile = profileById.get(row.memberId);
      const name = profile?.full_name || row.name || "Thành viên";
      return {
        memberId: row.memberId,
        username: profile?.username || row.username || row.memberId,
        name,
        initials: initialsFromName(name),
        level: row.level,
        eloRating: Math.round(Number(row.eloRating || ELO_INITIAL_RATING) * 10) / 10,
        rank: row.rank,
        matches: Number(row.matches || 0),
        color: colorForIndex(index),
      };
    });
};

async function loadPersistedEloRows(admin: SupabaseClient, activeProfiles: SupabaseProfile[]) {
  const memberIds = activeProfiles.flatMap((profile) => profile.id ? [profile.id] : []);
  if (!memberIds.length) return null;

  const { data, error } = await admin
    .from("elo_ratings")
    .select("member_id, elo_rating, updated_at")
    .in("member_id", memberIds);
  if (error) {
    if (isMissingEloFeature(error)) return null;
    throw error;
  }

  const ratingRows = (data || []) as EloRatingRow[];
  if (!ratingRows.length) return null;

  const ratingByMember = new Map(ratingRows.map((row) => [row.member_id, Number(row.elo_rating ?? ELO_INITIAL_RATING)]));
  const latestUpdatedAt = ratingRows.map((row) => row.updated_at).filter(Boolean).sort().at(-1);
  const ranked = rankEloPlayers(activeProfiles.flatMap((profile) => profile.id ? [{
    memberId: profile.id,
    username: profile.username || profile.id,
    name: profile.full_name || "Thành viên",
    eloRating: ratingByMember.get(profile.id) ?? ELO_INITIAL_RATING,
    matches: 0,
  }] : []));

  return {
    rows: buildEloRows(ranked, activeProfiles),
    status: {
      source: "database" as const,
      processedMatches: 0,
      message: latestUpdatedAt ? `ELO đang lấy từ bảng đã backfill, cập nhật gần nhất ${new Date(String(latestUpdatedAt)).toLocaleString("vi-VN")}.` : "ELO đang lấy từ bảng đã backfill.",
    },
  };
}

async function buildCalculatedEloRows(admin: SupabaseClient, activeProfiles: SupabaseProfile[]) {
  const { data, error } = await admin
    .from("play_sessions")
    .select("session_date, matches(id, match_no, team_a, team_b, score_a, score_b)")
    .order("session_date", { ascending: true });
  if (error) throw error;

  const sessions = (data || []) as EloSessionRow[];
  const matches = sessions.flatMap((session) => (session.matches || [])
    .filter(isScoredEloMatch)
    .map((match) => ({
      id: match.id,
      date: session.session_date,
      sessionNumber: 0,
      matchNumber: match.match_no,
      teamA: match.team_a as string[],
      teamB: match.team_b as string[],
      scoreA: match.score_a as number,
      scoreB: match.score_b as number,
    })));

  const replay = replayEloMatches({
    players: activeProfiles.flatMap((profile) => profile.id ? [{
      memberId: profile.id,
      username: profile.username || profile.id,
      name: profile.full_name || "Thành viên",
      rating: ELO_INITIAL_RATING,
    }] : []),
    matches,
 });

 return {
   rows: buildEloRows(replay.ratings, activeProfiles),
   status: {
     source: "calculated" as const,
     processedMatches: replay.processedMatches,
     message: "ELO đang được replay từ các trận đã lưu vì bảng ELO chưa được apply/backfill trong database.",
   },
 };
}

async function loadEloRanking(admin: SupabaseClient, activeProfiles: SupabaseProfile[]) {
 try {
   const persisted = await loadPersistedEloRows(admin, activeProfiles);
   if (persisted) return persisted;
   return await buildCalculatedEloRows(admin, activeProfiles);
 } catch (error) {
   console.warn("Unable to load ELO ranking", error instanceof Error ? error.message : error);
   const ranked = rankEloPlayers(activeProfiles.flatMap((profile) => profile.id ? [{
     memberId: profile.id,
     username: profile.username || profile.id,
     name: profile.full_name || "Thành viên",
     eloRating: ELO_INITIAL_RATING,
     matches: 0,
   }] : []));
   return {
     rows: buildEloRows(ranked, activeProfiles),
     status: {
       source: "unavailable" as const,
       processedMatches: 0,
       message: "Chưa tải được dữ liệu ELO, đang hiển thị mốc khởi điểm 1000 cho từng thành viên.",
     },
   };
 }
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
      admin.from("play_sessions").select("id, session_date, matches(match_no, team_a, team_b), attendances(choice)").eq("status", "completed").order("session_date", { ascending: false }),
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
    const { rows: eloRows, status: eloStatus } = await loadEloRanking(admin, activeProfileRows);
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
      const matchAttendees = attendeeCountFromMatches(session.matches);
      return {
        id: session.id,
        date: session.session_date,
        matches: matchCountFromHistoryRows(session.matches),
        attendees: matchAttendees || attendeeCountFromAttendances(session.attendances),
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
      eloRows,
      eloStatus,
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
