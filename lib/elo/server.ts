import { replayEloMatches } from "@/lib/elo/calculate-elo";
import { startRatingForProfile } from "@/lib/elo/start-rating";
import { isMissingEloFeature, writeEloInApplication } from "@/lib/elo/sync-elo";
import type { SupabaseClient } from "@supabase/supabase-js";

type ProfileRow = { id: string; is_active?: boolean | null; description?: string | null };
type StoredMatch = { id: string; match_no: number; team_a: string[] | null; team_b: string[] | null; score_a: number | null; score_b: number | null };
type SessionRow = { session_date: string; matches?: StoredMatch[] | null };

export { isMissingEloFeature };

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

// Brings ELO up to date with the saved matches, straight after every change to them. The database function
// does it in one transaction; when it fails or hangs, the same replay runs here and writes the tables,
// so a saved score never leaves the ELO behind. Returns false only when both ways failed.
// A rebuild takes well under a second; one that has not answered by then is stuck (e.g. waiting on its lock),
// so the app stops waiting and writes the ELO itself.
const ELO_RPC_TIMEOUT_MS = 5_000;

export async function recalculateEloIfAvailable(admin: SupabaseClient): Promise<boolean> {
  const { error } = await admin.rpc("recalculate_elo_from_matches").abortSignal(AbortSignal.timeout(ELO_RPC_TIMEOUT_MS));
  if (!error) return true;
  if (!isMissingEloFeature(error)) console.error("ELO: recalculate_elo_from_matches() failed, recalculating in the app", error);
  try {
    await writeEloInApplication(admin);
    return true;
  } catch (appError) {
    console.error("ELO: recalculation in the app failed too", appError);
    return false;
  }
}

export async function snapshotEloMonthIfAvailable(admin: SupabaseClient, month: string) {
  const { error } = await admin.rpc("snapshot_elo_month", { p_month: month });
  if (error && !isMissingEloFeature(error)) console.warn("ELO month snapshot failed", error.message);
}