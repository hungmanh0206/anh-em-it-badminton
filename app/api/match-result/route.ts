import type { SupabaseClient } from "@supabase/supabase-js";
import { recalculateEloIfAvailable } from "@/lib/elo/server";
import { CLOSED_MONTH_ERROR, deleteMatchResult, isMonthClosed, monthStart, rerankMonth } from "@/lib/match-result";
import { isValidScore } from "@/lib/score-input";
import { jsonError, requireScoreManager } from "@/lib/supabase-admin";

type Body = {
  sessionId?: string;
  matchNo?: number;
  matchType?: string;
  teamA?: number[];
  teamB?: number[];
  scoreA?: number;
  scoreB?: number;
  totalMatches?: number;
};

type StoredMatch = {
  team_a: string[];
  team_b: string[];
  score_a: number | null;
  score_b: number | null;
};

type MonthlyResult = {
  id: string;
  rank: number;
  total_points: number;
  points_for: number;
  points_against: number;
  point_diff: number;
  matches_played: number;
  level_next_month: "1" | "2";
};

type MemberLevels = Map<string, "1" | "2">;

const SCHEDULE_NOT_CONFIRMED_ERROR = "Lịch thi đấu chưa được xác nhận nên chưa thể nhập điểm.";

async function adjustMonthlyResult(admin: SupabaseClient, month: string, levels: MemberLevels, memberId: string, delta: { total: number; for: number; against: number; matches: number }) {
  const { data: existing, error: readError } = await admin
    .from("monthly_results")
    .select("id, rank, total_points, points_for, points_against, point_diff, matches_played, level_next_month")
    .eq("month", month)
    .eq("member_id", memberId)
    .maybeSingle();
  if (readError) throw readError;
  const base = existing as MonthlyResult | null;
  const current = base || { rank: 999, total_points: 0, points_for: 0, points_against: 0, matches_played: 0, level_next_month: levels.get(memberId) || "2" };
  const pointsFor = Math.max(0, current.points_for + delta.for);
  const pointsAgainst = Math.max(0, current.points_against + delta.against);
  const matchesPlayed = Math.max(0, current.matches_played + delta.matches);
  const nextValues = {
    rank: matchesPlayed > 0 ? current.rank : 999,
    total_points: Math.max(0, current.total_points + delta.total),
    points_for: pointsFor,
    points_against: pointsAgainst,
    point_diff: pointsFor - pointsAgainst,
    matches_played: matchesPlayed,
    level_next_month: current.level_next_month,
  };
  // New members get their final values in one insert instead of insert-then-update.
  const { error: writeError } = base
    ? await admin.from("monthly_results").update(nextValues).eq("month", month).eq("member_id", memberId)
    : await admin.from("monthly_results").insert({ month, member_id: memberId, ...nextValues });
  if (writeError) throw writeError;
}

async function applyMatchDelta(admin: SupabaseClient, month: string, levels: MemberLevels, match: StoredMatch, sign: 1 | -1) {
  if (typeof match.score_a !== "number" || typeof match.score_b !== "number") return;
  const aWon = match.score_a > match.score_b;
  // The four players in one match are distinct, so their rows can be adjusted in parallel.
  await Promise.all([
    ...match.team_a.map((memberId) => adjustMonthlyResult(admin, month, levels, memberId, { total: aWon ? sign : 0, for: match.score_a! * sign, against: match.score_b! * sign, matches: sign })),
    ...match.team_b.map((memberId) => adjustMonthlyResult(admin, month, levels, memberId, { total: aWon ? 0 : sign, for: match.score_b! * sign, against: match.score_a! * sign, matches: sign })),
  ]);
}

export async function POST(request: Request) {
  try {
    const { admin } = await requireScoreManager(request);
    const body = await request.json() as Body;
    if (!body.sessionId || !Number.isInteger(body.matchNo) || !Array.isArray(body.teamA) || !Array.isArray(body.teamB)) {
      return Response.json({ error: "Thiếu dữ liệu trận đấu." }, { status: 400 });
    }
    if (body.teamA.length !== 2 || body.teamB.length !== 2) return Response.json({ error: "Mỗi đội phải có đúng 2 người." }, { status: 400 });
    if (!isValidScore(body.scoreA) || !isValidScore(body.scoreB)) return Response.json({ error: "Điểm chỉ gồm số, tối đa 2 chữ số." }, { status: 400 });
    if (body.scoreA === body.scoreB) return Response.json({ error: "Kết quả không được hòa." }, { status: 400 });
    const scoreA = Number(body.scoreA);
    const scoreB = Number(body.scoreB);

    const allSlots = [...body.teamA, ...body.teamB];
    if (new Set(allSlots).size !== 4) return Response.json({ error: "Một trận không được lặp người chơi." }, { status: 400 });

    const [{ data: playSession, error: sessionError }, { data: attendances, error: attendanceError }, { data: oldMatch, error: oldMatchError }] = await Promise.all([
      admin.from("play_sessions").select("id, session_date, status").eq("id", body.sessionId).single(),
      admin.from("attendances").select("member_id, drawn_number").eq("session_id", body.sessionId).in("drawn_number", allSlots),
      admin.from("matches").select("team_a, team_b, score_a, score_b").eq("session_id", body.sessionId).eq("match_no", body.matchNo).maybeSingle(),
    ]);
    if (sessionError) throw sessionError;
    if (attendanceError) throw attendanceError;
    if (oldMatchError) throw oldMatchError;
    if (!playSession) return Response.json({ error: "Không tìm thấy buổi chơi." }, { status: 404 });
    // Scores are only accepted once an admin has confirmed the schedule for this session.
    if (!["scheduled", "completed"].includes(String(playSession.status))) {
      return Response.json({ error: SCHEDULE_NOT_CONFIRMED_ERROR }, { status: 400 });
    }

    const slotToMember = new Map((attendances || []).map((attendance) => [attendance.drawn_number, attendance.member_id]));
    const teamAIds = body.teamA.map((slot) => slotToMember.get(slot));
    const teamBIds = body.teamB.map((slot) => slotToMember.get(slot));
    if (teamAIds.some((id) => !id) || teamBIds.some((id) => !id)) {
      return Response.json({ error: "Một số trong lịch chưa có người bốc tương ứng." }, { status: 400 });
    }

    const month = monthStart(playSession.session_date);
    const previousMatch = oldMatch as StoredMatch | null;
    const participantIds = [...new Set([...(previousMatch?.team_a || []), ...(previousMatch?.team_b || []), ...teamAIds, ...teamBIds].filter(Boolean) as string[])];
    const [monthClosed, { data: profiles, error: profilesError }] = await Promise.all([
      isMonthClosed(admin, playSession.session_date),
      admin.from("profiles").select("id, level").in("id", participantIds),
    ]);
    if (monthClosed) return Response.json({ error: CLOSED_MONTH_ERROR }, { status: 400 });
    if (profilesError) throw profilesError;
    const levels: MemberLevels = new Map((profiles || []).map((profile) => [profile.id, profile.level as "1" | "2"]));

    if (previousMatch) await applyMatchDelta(admin, month, levels, previousMatch, -1);

    const newMatch: StoredMatch = {
      team_a: teamAIds as string[],
      team_b: teamBIds as string[],
      score_a: scoreA,
      score_b: scoreB,
    };
    const { error: upsertError } = await admin.from("matches").upsert({
      session_id: body.sessionId,
      match_no: body.matchNo,
      match_type: body.matchType || null,
      team_a: newMatch.team_a,
      team_b: newMatch.team_b,
      score_a: scoreA,
      score_b: scoreB,
    }, { onConflict: "session_id,match_no" });
    if (upsertError) throw upsertError;

    await applyMatchDelta(admin, month, levels, newMatch, 1);
    await rerankMonth(admin, month);

    const sessionId = body.sessionId;
    const updateSessionStatus = async () => {
      const { count, error: countError } = await admin
        .from("matches")
        .select("id", { count: "exact", head: true })
        .eq("session_id", sessionId)
        .not("score_a", "is", null)
        .not("score_b", "is", null);
      if (countError) throw countError;
      const isCompleted = Boolean(body.totalMatches && count && count >= body.totalMatches);
      const { error: statusError } = await admin.from("play_sessions").update({ status: isCompleted ? "completed" : "scheduled" }).eq("id", sessionId);
      if (statusError) throw statusError;
      return isCompleted;
    };
    // ELO replays from the matches table, which is already written, so it can run alongside the status update.
    const [completed] = await Promise.all([updateSessionStatus(), recalculateEloIfAvailable(admin)]);

    return Response.json({ ok: true, completed });
  } catch (error) {
    return jsonError(error);
  }
}

// DELETE /api/match-result { sessionId, matchNo } — takes a saved result back out; see deleteMatchResult.
export async function DELETE(request: Request) {
  try {
    const { admin } = await requireScoreManager(request);
    const body = await request.json().catch(() => ({})) as Body;
    if (!body.sessionId || !Number.isInteger(body.matchNo) || Number(body.matchNo) < 1) return Response.json({ error: "Thiếu dữ liệu trận đấu." }, { status: 400 });

    const result = await deleteMatchResult(admin, { sessionId: body.sessionId, matchNo: body.matchNo }, { recalculateElo: () => recalculateEloIfAvailable(admin) });
    if (result.error) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ ok: true, completed: false });
  } catch (error) {
    return jsonError(error);
  }
}
