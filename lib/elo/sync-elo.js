// ELO rebuilt in the app from the saved matches and written to elo_ratings, elo_history and profiles.level.
// Used whenever the database function recalculate_elo_from_matches() fails, so a saved score always moves
// the ELO straight away. Plain JS with the Supabase client passed in, so it all runs under node --test.
import { rankEloPlayers, replayEloMatches } from "./calculate-elo.js";
import { startRatingForProfile } from "./start-rating.js";

// The same matches the database function counts (migration 010): two players a side and a score with no tie,
// whatever the session's status.
const isScoredEloMatch = (match) =>
  Array.isArray(match.team_a) &&
  Array.isArray(match.team_b) &&
  match.team_a.length === 2 &&
  match.team_b.length === 2 &&
  typeof match.score_a === "number" &&
  typeof match.score_b === "number" &&
  match.score_a !== match.score_b;

// elo_ratings / elo_history store numeric(10,4).
const round4 = (value) => Math.round(Number(value) * 10_000) / 10_000;

export const isMissingEloFeature = (error) => {
  const message = String(error?.message || "").toLowerCase();
  return ["PGRST202", "42883", "42P01"].includes(String(error?.code || "")) ||
    message.includes("recalculate_elo_from_matches") ||
    message.includes("snapshot_elo_month") ||
    message.includes("elo_ratings") ||
    message.includes("elo_monthly_snapshots") ||
    message.includes("could not find the function") ||
    message.includes("could not find the table");
};

// Pure: every member's rating, one history row per player per match, and the level of each active member.
export function computeEloState({ profiles, sessions }) {
  const profileRows = profiles || [];
  const matches = (sessions || [])
    .flatMap((session) => (session.matches || []).filter(isScoredEloMatch).map((match) => ({
      id: match.id,
      date: session.session_date,
      sessionNumber: 0,
      matchNumber: match.match_no,
      teamA: match.team_a,
      teamB: match.team_b,
      scoreA: match.score_a,
      scoreB: match.score_b,
    })));
  if (!profileRows.length) return { ratings: [], history: [], levels: [], processedMatches: 0 };

  const replay = replayEloMatches({
    players: profileRows.map((profile) => ({ memberId: profile.id, rating: startRatingForProfile(profile) })),
    matches,
  });
  const profileIds = new Set(profileRows.map((profile) => profile.id));
  const activeIds = new Set(profileRows.filter((profile) => profile.is_active !== false).map((profile) => profile.id));
  const ratings = replay.ratings
    .filter((row) => profileIds.has(row.memberId))
    .map((row) => ({ member_id: row.memberId, elo_rating: round4(row.eloRating) }));
  const history = replay.history
    .filter((row) => profileIds.has(row.memberId))
    .map((row) => ({ member_id: row.memberId, match_id: row.matchId, elo_before: round4(row.eloBefore), elo_change: round4(row.eloChange), elo_after: round4(row.eloAfter) }));
  const levels = rankEloPlayers(replay.ratings.filter((row) => activeIds.has(row.memberId)))
    .map((row) => ({ id: row.memberId, level: String(row.level) }));
  return { ratings, history, levels, processedMatches: matches.length };
}

const throwIfFailed = (results) => {
  const failed = results.find((result) => result?.error);
  if (failed?.error) throw failed.error;
};

const HISTORY_CHUNK = 500;
const chunks = (rows, size) => Array.from({ length: Math.ceil(rows.length / size) }, (_, index) => rows.slice(index * size, (index + 1) * size));

// Rebuilds ELO from the matches table and writes it. Running it again changes nothing, so a retry repairs
// a failure. Without the ELO tables (migration 008 not applied) only the levels are written.
export async function writeEloInApplication(admin) {
  const [{ data: profiles, error: profileError }, { data: sessions, error: sessionError }] = await Promise.all([
    admin.from("profiles").select("id, is_active, description, level"),
    admin.from("play_sessions").select("session_date, matches(id, match_no, team_a, team_b, score_a, score_b)").order("session_date", { ascending: true }),
  ]);
  if (profileError) throw profileError;
  if (sessionError) throw sessionError;

  const state = computeEloState({ profiles, sessions });
  const now = new Date().toISOString();

  const { data: storedHistory, error: storedHistoryError } = await admin.from("elo_history").select("id, match_id, member_id");
  const hasEloTables = !(storedHistoryError && isMissingEloFeature(storedHistoryError));
  if (storedHistoryError && hasEloTables) throw storedHistoryError;

  if (hasEloTables) {
    // History first: the ratings write below is what the app listens to, so it should land on a full history.
    const keep = new Set(state.history.map((row) => `${row.match_id}:${row.member_id}`));
    const staleIds = (storedHistory || []).filter((row) => !keep.has(`${row.match_id}:${row.member_id}`)).map((row) => row.id);
    throwIfFailed(await Promise.all([
      ...chunks(state.history, HISTORY_CHUNK).map((rows) => admin.from("elo_history").upsert(rows.map((row) => ({ ...row, created_at: now })), { onConflict: "match_id,member_id" })),
      ...chunks(staleIds, HISTORY_CHUNK).map((ids) => admin.from("elo_history").delete().in("id", ids)),
    ]));
  }

  const currentLevel = new Map((profiles || []).map((profile) => [profile.id, String(profile.level ?? "")]));
  const changedLevels = state.levels.filter((row) => currentLevel.get(row.id) !== row.level);
  throwIfFailed(await Promise.all(changedLevels.map((row) => admin.from("profiles").update({ level: row.level, updated_at: now }).eq("id", row.id))));

  if (hasEloTables && state.ratings.length) {
    throwIfFailed([await admin.from("elo_ratings").upsert(state.ratings.map((row) => ({ ...row, updated_at: now })), { onConflict: "member_id" })]);
  }
  return { processedMatches: state.processedMatches, players: state.ratings.length, levelsChanged: changedLevels.length };
}
