// Month helpers and the "delete a saved result" flow behind DELETE /api/match-result.
// Plain JS with the Supabase client passed in, so the whole flow runs under node --test.

const NOT_OPEN_ERROR = "Lịch thi đấu chưa được xác nhận nên chưa thể nhập điểm.";
export const CLOSED_MONTH_ERROR = "Tháng này đã chốt BXH, không thể nhập hoặc sửa điểm nữa.";

const pad = (value) => String(value).padStart(2, "0");

export const monthStart = (dateText) => `${String(dateText).slice(0, 7)}-01`;

export const nextMonthStart = (dateText) => {
  const [year, month] = String(dateText).split("-").map(Number);
  return month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`;
};

export async function isMonthClosed(admin, sessionDate) {
  const { count, error } = await admin
    .from("monthly_results")
    .select("id", { count: "exact", head: true })
    .eq("month", nextMonthStart(sessionDate));
  if (error) throw error;
  return (count || 0) > 0;
}

const isScored = (match) => typeof match.score_a === "number" && typeof match.score_b === "number";

// Wins, points for / against and matches per member, from scored matches only.
export function monthlyTotalsFromMatches(matches) {
  const totals = new Map();
  const add = (memberId, won, pointsFor, pointsAgainst) => {
    const current = totals.get(memberId) ?? { total: 0, for: 0, against: 0, matches: 0 };
    totals.set(memberId, { total: current.total + (won ? 1 : 0), for: current.for + pointsFor, against: current.against + pointsAgainst, matches: current.matches + 1 });
  };
  for (const match of matches.filter(isScored)) {
    const aWon = match.score_a > match.score_b;
    match.team_a.forEach((memberId) => add(memberId, aWon, match.score_a, match.score_b));
    match.team_b.forEach((memberId) => add(memberId, !aWon, match.score_b, match.score_a));
  }
  return totals;
}

export async function rerankMonth(admin, month) {
  const { data: rankRows, error: rankError } = await admin
    .from("monthly_results")
    .select("id, rank, total_points, points_for, point_diff, matches_played, created_at")
    .eq("month", month)
    .gt("matches_played", 0);
  if (rankError) throw rankError;
  const sortedRows = [...(rankRows || [])].sort((a, b) =>
    b.total_points - a.total_points ||
    b.point_diff - a.point_diff ||
    b.points_for - a.points_for ||
    a.matches_played - b.matches_played ||
    String(a.created_at).localeCompare(String(b.created_at))
  );
  // Only rows whose rank actually moved are written, all in parallel.
  const rankUpdates = await Promise.all(sortedRows
    .map((row, index) => ({ id: row.id, oldRank: row.rank, rank: index + 1 }))
    .filter((row) => row.oldRank !== row.rank)
    .map((row) => admin.from("monthly_results").update({ rank: row.rank }).eq("id", row.id)));
  const failedRankUpdate = rankUpdates.find((result) => result.error);
  if (failedRankUpdate?.error) throw failedRankUpdate.error;
}

// Sets the month's rows from the matches themselves. Unlike subtracting, running it again changes
// nothing, so a retry repairs a delete that failed half way. Rows with no matches left rank 999.
export async function recomputeMonthlyResults(admin, month) {
  const [{ data: sessions, error: sessionsError }, { data: rows, error: rowsError }] = await Promise.all([
    admin.from("play_sessions").select("matches(team_a, team_b, score_a, score_b)").gte("session_date", month).lt("session_date", nextMonthStart(month)),
    admin.from("monthly_results").select("id, member_id, rank, total_points, points_for, points_against, matches_played").eq("month", month),
  ]);
  if (sessionsError) throw sessionsError;
  if (rowsError) throw rowsError;

  const totals = monthlyTotalsFromMatches((sessions || []).flatMap((session) => session.matches || []));
  const updates = await Promise.all((rows || []).flatMap((row) => {
    const next = totals.get(row.member_id) ?? { total: 0, for: 0, against: 0, matches: 0 };
    const unchanged = row.total_points === next.total && row.points_for === next.for && row.points_against === next.against && row.matches_played === next.matches;
    if (unchanged) return [];
    return [admin.from("monthly_results").update({
      total_points: next.total,
      points_for: next.for,
      points_against: next.against,
      point_diff: next.for - next.against,
      matches_played: next.matches,
      rank: next.matches > 0 ? row.rank : 999,
    }).eq("id", row.id)];
  }));
  const failedUpdate = updates.find((result) => result.error);
  if (failedUpdate?.error) throw failedUpdate.error;
}

// Removes a match's saved result; the ranking, session status and ELO follow. Returns { status, error }
// when refused. The row delete is the single atomic step: two requests cannot both remove it, and
// everything after it is safe to repeat, so a retry after a failure finishes the job.
export async function deleteMatchResult(admin, { sessionId, matchNo }, { recalculateElo }) {
  const { data: playSession, error: sessionError } = await admin.from("play_sessions").select("id, session_date, status").eq("id", sessionId).single();
  if (sessionError) throw sessionError;
  if (!playSession) return { status: 404, error: "Không tìm thấy buổi chơi." };
  if (!["scheduled", "completed"].includes(String(playSession.status))) return { status: 400, error: NOT_OPEN_ERROR };
  if (await isMonthClosed(admin, playSession.session_date)) return { status: 400, error: CLOSED_MONTH_ERROR };

  const { error: deleteError } = await admin.from("matches").delete().eq("session_id", sessionId).eq("match_no", matchNo);
  if (deleteError) throw deleteError;

  const month = monthStart(playSession.session_date);
  await recomputeMonthlyResults(admin, month);
  await rerankMonth(admin, month);
  // One match is unplayed again, so a finished session reopens.
  if (playSession.status === "completed") {
    const { error: statusError } = await admin.from("play_sessions").update({ status: "scheduled" }).eq("id", sessionId);
    if (statusError) throw statusError;
  }
  await recalculateElo();
  return { ok: true };
}
