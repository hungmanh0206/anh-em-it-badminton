import { rankEloPlayers, replayEloMatches } from "@/lib/elo/calculate-elo";
import { startRatingForProfile } from "@/lib/elo/start-rating";
import type { SupabaseClient } from "@supabase/supabase-js";

type SupabaseMaybeError = { code?: string; message?: string } | null | undefined;
type ProfileRow = { id: string; is_active?: boolean | null; description?: string | null };
type StoredMatch = { id: string; match_no: number; team_a: string[] | null; team_b: string[] | null; score_a: number | null; score_b: number | null };
type SessionRow = { session_date: string; matches?: StoredMatch[] | null };

export const isMissingEloFeature = (error: SupabaseMaybeError) => {
  const message = String(error?.message || "").toLowerCase();
  return ["PGRST202", "42883", "42P01"].includes(String(error?.code || "")) ||
    message.includes("recalculate_elo_from_matches") ||
    message.includes("snapshot_elo_month") ||
    message.includes("elo_ratings") ||
    message.includes("elo_monthly_snapshots") ||
    message.includes("could not find the function") ||
    message.includes("could not find the table");
};

const isScoredMatch = (match: StoredMatch) =>
  Array.isArray(match.team_a) &&
  Array.isArray(match.team_b) &&
  match.team_a.length === 2 &&
  match.team_b.length === 2 &&
  typeof match.score_a === "number" &&
  typeof match.score_b === "number" &&
  match.score_a !== match.score_b;

// Replays every scored match (each member starting from their stored start rating) and returns the
// current ratings of active members.
async function replayActiveEloRatings(admin: SupabaseClient): Promise<{ memberId: string; eloRating: number }[]> {
  const [{ data: profiles, error: profileError }, { data: sessions, error: sessionError }] = await Promise.all([
    admin.from("profiles").select("id, is_active, description"),
    admin.from("play_sessions").select("session_date, matches(id, match_no, team_a, team_b, score_a, score_b)").order("session_date", { ascending: true }),
  ]);
  if (profileError) throw profileError;
  if (sessionError) throw sessionError;

  const profileRows = (profiles || []) as ProfileRow[];
  const activeMemberIds = new Set(profileRows.filter((profile) => profile.is_active !== false).map((profile) => profile.id));
  if (!activeMemberIds.size) return [];

  const matches = ((sessions || []) as SessionRow[]).flatMap((session) => (session.matches || [])
    .filter(isScoredMatch)
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
    players: profileRows.map((profile) => ({ memberId: profile.id, rating: startRatingForProfile(profile) })),
    matches,
  });
  return replay.ratings.filter((row: { memberId: string }) => activeMemberIds.has(row.memberId));
}

// Current ELO of every active member: the stored table when the ELO migration is applied, otherwise a replay.
export async function currentEloRatings(admin: SupabaseClient) {
  const { data, error } = await admin.from("elo_ratings").select("member_id, elo_rating");
  if (!error && data?.length) return (data as { elo_rating: number | string | null }[]).map((row) => Number(row.elo_rating));
  if (error && !isMissingEloFeature(error)) throw error;
  return (await replayActiveEloRatings(admin)).map((row) => row.eloRating);
}

async function recalculateEloLevelsInApplication(admin: SupabaseClient) {
  const ratings = await replayActiveEloRatings(admin);
  if (!ratings.length) return;
  const assignments = rankEloPlayers(ratings);

  const updates = await Promise.all(assignments.map((assignment: { memberId: string; level: 1 | 2 }) => admin
    .from("profiles")
    .update({ level: String(assignment.level) })
    .eq("id", assignment.memberId)));
  const failed = updates.find((result) => result.error);
  if (failed?.error) throw failed.error;
}

export async function recalculateEloIfAvailable(admin: SupabaseClient) {
  const { error } = await admin.rpc("recalculate_elo_from_matches");
  if (!error) return;
  if (isMissingEloFeature(error)) {
    await recalculateEloLevelsInApplication(admin);
    return;
  }
  console.warn("ELO recalculation failed", error.message);
}

export async function snapshotEloMonthIfAvailable(admin: SupabaseClient, month: string) {
  const { error } = await admin.rpc("snapshot_elo_month", { p_month: month });
  if (error && !isMissingEloFeature(error)) console.warn("ELO month snapshot failed", error.message);
}