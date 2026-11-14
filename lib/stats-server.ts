import { ELO_INITIAL_RATING } from "@/lib/elo/constants";
import { replayEloMatches } from "@/lib/elo/calculate-elo";
import { startRatingForProfile } from "@/lib/elo/start-rating";
import { isMissingEloFeature } from "@/lib/elo/server";
import { buildStatsData } from "@/lib/stats";
import type { SupabaseClient } from "@supabase/supabase-js";

type Profile = { id: string; username: string | null; full_name: string | null; level: number | string | null; is_active: boolean | null; created_at: string | null; description: string | null };
type StatMatch = { a: string[]; b: string[] };
type StatSession = { date: string; present: string[] };
type SessionRow = { id: string; session_date: string };
type MatchRow = { id: string; session_id: string; match_no: number; team_a: string[] | null; team_b: string[] | null; score_a: number | null; score_b: number | null };
type AttendanceRow = { session_id: string; member_id: string; choice: string };
type HistoryRow = { member_id: string; match_id: string; elo_before: number | string; elo_after: number | string };

const PAGE = 1000;

// Supabase returns at most 1000 rows a request; the ELO history alone has four rows a match, so read in pages.
// The order must be unique per row, or pages could repeat or skip rows.
async function readAll<T>(admin: SupabaseClient, table: string, columns: string, order: string[]) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = admin.from(table).select(columns);
    for (const column of order) query = query.order(column, { ascending: true });
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) return { rows, error };
    rows.push(...((data || []) as T[]));
    if (!data || data.length < PAGE) return { rows, error: null };
  }
}

// Xếp hạng › Thống kê and the member pages: the club's scored matches, sessions and members in one compact payload.
// The screens work the numbers out from it (lib/stats.js), so changing a filter needs no new request.
export async function loadStatsPayload(admin: SupabaseClient) {
  const [profiles, sessions, matches, attendances, history, ratings] = await Promise.all([
    readAll<Profile>(admin, "profiles", "id, username, full_name, level, is_active, created_at, description", ["id"]),
    readAll<SessionRow>(admin, "play_sessions", "id, session_date", ["session_date", "id"]),
    readAll<MatchRow>(admin, "matches", "id, session_id, match_no, team_a, team_b, score_a, score_b", ["id"]),
    readAll<AttendanceRow>(admin, "attendances", "session_id, member_id, choice", ["session_id", "member_id"]),
    readAll<HistoryRow>(admin, "elo_history", "member_id, match_id, elo_before, elo_after", ["id"]),
    readAll<{ member_id: string; elo_rating: number | string }>(admin, "elo_ratings", "member_id, elo_rating", ["member_id"]),
  ]);
  const failed = profiles.error || sessions.error || matches.error || attendances.error;
  if (failed) throw failed;

  // ELO as the ELO tab shows it: the stored history and ratings, or, where the ELO tables are not set up yet,
  // the same replay of every scored match the ELO tab falls back to.
  // Any trouble reading them (tables not created yet, a passing error) falls back to the replay, as the ELO tab does.
  const eloStored = !history.error && !ratings.error && ratings.rows.length > 0 && history.rows.length > 0;
  if ((history.error && !isMissingEloFeature(history.error)) || (ratings.error && !isMissingEloFeature(ratings.error))) console.warn("Stats: reading stored ELO failed, replaying matches instead", (history.error || ratings.error)?.message);
  let historyRows = history.rows;
  let currentRating = new Map(ratings.rows.map((row) => [row.member_id, Number(row.elo_rating)]));
  if (!eloStored) {
    const dateOf = new Map(sessions.rows.map((s) => [s.id, s.session_date]));
    const replay = replayEloMatches({
      players: profiles.rows.filter((p) => p.is_active !== false).map((p) => ({ memberId: p.id, username: p.username || p.id, name: p.full_name || "Thành viên", rating: startRatingForProfile(p) })),
      matches: matches.rows
        .filter((m) => dateOf.has(m.session_id) && Number.isFinite(m.score_a) && Number.isFinite(m.score_b) && m.score_a !== m.score_b && m.team_a?.length === 2 && m.team_b?.length === 2)
        .map((m) => ({ id: m.id, date: dateOf.get(m.session_id), sessionNumber: 0, matchNumber: m.match_no, teamA: m.team_a, teamB: m.team_b, scoreA: m.score_a, scoreB: m.score_b })),
    });
    historyRows = replay.history.map((h: { matchId: string; memberId: string; eloBefore: number; eloAfter: number }) => ({ match_id: h.matchId, member_id: h.memberId, elo_before: h.eloBefore, elo_after: h.eloAfter }));
    currentRating = new Map(replay.ratings.map((r: { memberId: string; eloRating: number }) => [r.memberId, r.eloRating]));
  }

  const data = buildStatsData({ sessions: sessions.rows, matches: matches.rows, attendances: attendances.rows, history: historyRows });

  // Members: everyone who has played (so old matches keep their names), active ones flagged for the pickers.
  // A member "joins" on the earlier of their account date and the first session they came to.
  const firstSeen = new Map<string, string>();
  for (const session of data.sessions as StatSession[]) for (const id of session.present) if (!firstSeen.has(id)) firstSeen.set(id, session.date);
  const played = new Set((data.matches as StatMatch[]).flatMap((m) => [...m.a, ...m.b]));
  const members = profiles.rows
    .filter((p) => p.is_active !== false || played.has(p.id))
    .map((p) => {
      const created = p.created_at ? p.created_at.slice(0, 10) : null;
      const seen = firstSeen.get(p.id) ?? null;
      return {
        id: p.id,
        username: p.username || p.id,
        name: p.full_name || "Thành viên",
        level: Number(p.level) === 1 ? 1 : 2,
        active: p.is_active !== false,
        joinedOn: created && seen ? (created < seen ? created : seen) : created ?? seen,
        elo: currentRating.get(p.id) ?? (p.is_active !== false ? startRatingForProfile(p) : ELO_INITIAL_RATING),
      };
    });

  return { members, ...data, eloSource: eloStored ? "stored" : "replayed" };
}
