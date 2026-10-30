// Month helpers and the shared steps behind every change to saved results (save, delete, attendance
// change, session reset). Plain JS with the Supabase client passed in, so it all runs under node --test.

export const NOT_OPEN_ERROR = "Lịch thi đấu chưa được xác nhận nên chưa thể nhập điểm.";
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

async function rerankMonth(admin, month) {
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
  const moved = sortedRows
    .map((row, index) => ({ id: row.id, oldRank: row.rank, rank: index + 1 }))
    .filter((row) => row.oldRank !== row.rank);
  const rankUpdates = await Promise.all(moved.map((row) => admin.from("monthly_results").update({ rank: row.rank }).eq("id", row.id)));
  const failedRankUpdate = rankUpdates.find((result) => result.error);
  if (failedRankUpdate?.error) throw failedRankUpdate.error;
  return moved.length;
}

// One pass: sets the month's rows from the matches themselves and returns how many rows it wrote.
async function writeMonthlyTotals(admin, month) {
  const [{ data: sessions, error: sessionsError }, { data: rows, error: rowsError }] = await Promise.all([
    admin.from("play_sessions").select("matches(team_a, team_b, score_a, score_b)").gte("session_date", month).lt("session_date", nextMonthStart(month)),
    admin.from("monthly_results").select("id, member_id, rank, total_points, points_for, points_against, matches_played").eq("month", month),
  ]);
  if (sessionsError) throw sessionsError;
  if (rowsError) throw rowsError;

  const totals = monthlyTotalsFromMatches((sessions || []).flatMap((session) => session.matches || []));
  const existing = rows || [];
  const known = new Set(existing.map((row) => row.member_id));
  const newMemberIds = [...totals.keys()].filter((memberId) => !known.has(memberId));
  const values = (next) => ({ total_points: next.total, points_for: next.for, points_against: next.against, point_diff: next.for - next.against, matches_played: next.matches });

  const updates = existing.flatMap((row) => {
    const next = totals.get(row.member_id) ?? { total: 0, for: 0, against: 0, matches: 0 };
    const unchanged = row.total_points === next.total && row.points_for === next.for && row.points_against === next.against && row.matches_played === next.matches;
    return unchanged ? [] : [admin.from("monthly_results").update({ ...values(next), rank: next.matches > 0 ? row.rank : 999 }).eq("id", row.id)];
  });
  if (newMemberIds.length) {
    const { data: profiles, error: profilesError } = await admin.from("profiles").select("id, level").in("id", newMemberIds);
    if (profilesError) throw profilesError;
    const levels = new Map((profiles || []).map((profile) => [profile.id, profile.level]));
    // upsert: two requests may both find a member's first row of the month missing.
    updates.push(admin.from("monthly_results").upsert(newMemberIds.map((memberId) => ({
      month,
      member_id: memberId,
      rank: 999,
      level_next_month: levels.get(memberId) || "2",
      ...values(totals.get(memberId)),
    })), { onConflict: "month,member_id" }));
  }
  const results = await Promise.all(updates);
  const failedUpdate = results.find((result) => result.error);
  if (failedUpdate?.error) throw failedUpdate.error;
  return updates.length;
}

// Makes the month's ranking match its saved matches. Each pass re-reads everything, and a request only
// stops after a pass that found nothing to write, so when several requests overlap the last one to
// finish leaves the correct result. Running it again changes nothing, so a retry repairs a failure.
export async function syncMonthlyResults(admin, month) {
  for (let pass = 0; pass < 6; pass += 1) {
    const written = await writeMonthlyTotals(admin, month);
    const moved = await rerankMonth(admin, month);
    if (!written && !moved) return;
  }
  throw new Error("BXH đang được nhiều người cập nhật, vui lòng thử lại.");
}

// "completed" exactly while every match of the session has a result. Re-counts after writing, so a
// save and a delete that overlap cannot leave the wrong status behind. Returns whether it is completed.
export async function syncSessionStatus(admin, sessionId, totalMatches) {
  const countScored = async () => {
    const { data, error } = await admin.from("matches").select("score_a, score_b").eq("session_id", sessionId);
    if (error) throw error;
    return (data || []).filter(isScored).length;
  };
  for (let pass = 0; pass < 4; pass += 1) {
    const scored = await countScored();
    const completed = Boolean(totalMatches && scored >= totalMatches);
    const { error } = await admin.from("play_sessions").update({ status: completed ? "completed" : "scheduled" }).eq("id", sessionId).in("status", ["scheduled", "completed"]);
    if (error) throw error;
    if (await countScored() === scored) return completed;
  }
  throw new Error("Buổi chơi đang được nhiều người cập nhật, vui lòng thử lại.");
}

// True when the session has saved results; used to refuse resets that would change a closed month.
export async function sessionHasResults(admin, sessionId) {
  const { data, error } = await admin.from("matches").select("score_a, score_b").eq("session_id", sessionId);
  if (error) throw error;
  return (data || []).some(isScored);
}

// Removes a match's saved result; the ranking, session status and ELO follow. Returns { status, error }
// when refused. Deleting the row is the only step that is not repeatable, and it comes first: a second
// request deletes nothing, and everything after it is safe to run again, so a retry finishes the job.
export async function deleteMatchResult(admin, { sessionId, matchNo, totalMatches }, { recalculateElo }) {
  const { data: playSession, error: sessionError } = await admin.from("play_sessions").select("id, session_date, status").eq("id", sessionId).single();
  if (sessionError) throw sessionError;
  if (!playSession) return { status: 404, error: "Không tìm thấy buổi chơi." };
  if (!["scheduled", "completed"].includes(String(playSession.status))) return { status: 400, error: NOT_OPEN_ERROR };
  if (await isMonthClosed(admin, playSession.session_date)) return { status: 400, error: CLOSED_MONTH_ERROR };

  const { error: deleteError } = await admin.from("matches").delete().eq("session_id", sessionId).eq("match_no", matchNo);
  if (deleteError) throw deleteError;

  await syncMonthlyResults(admin, monthStart(playSession.session_date));
  await syncSessionStatus(admin, sessionId, totalMatches);
  await recalculateElo();
  return { ok: true };
}
