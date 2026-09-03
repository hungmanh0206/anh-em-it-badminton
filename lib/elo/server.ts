import { ELO_INITIAL_RATING } from "@/lib/elo/constants";
import { rankEloPlayers, replayEloMatches } from "@/lib/elo/calculate-elo";
import type { SupabaseClient } from "@supabase/supabase-js";

type SupabaseMaybeError = { code?: string; message?: string } | null | undefined;
type ProfileRow = { id: string; is_active?: boolean | null };
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

async function recalculateEloLevelsInApplication(admin: SupabaseClient) {
  const [{ data: profiles, error: profileError }, { data: sessions, error: sessionError }] = await Promise.all([
    admin.from("profiles").select("id, is_active"),
    admin.from("play_sessions").select("session_date, matches(id, match_no, team_a, team_b, score_a, score_b)").order("session_date", { ascending: true }),
  ]);
  if (profileError) throw profileError;
  if (sessionError) throw sessionError;

  const profileRows = (profiles || []) as ProfileRow[];
  const activeMemberIds = new Set(profileRows.filter((profile) => profile.is_active !== false).map((profile) => profile.id));
  if (!activeMemberIds.size) return;

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
    players: profileRows.map((profile) => ({ memberId: profile.id, rating: ELO_INITIAL_RATING })),
    matches,
  });
  const assignments = rankEloPlayers(replay.ratings.filter((row: { memberId: string }) => activeMemberIds.has(row.memberId)));

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