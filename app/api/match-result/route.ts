import { recalculateEloIfAvailable } from "@/lib/elo/server";
import { CLOSED_MONTH_ERROR, deleteMatchResult, isMonthClosed, monthStart, NOT_OPEN_ERROR, syncMonthlyResults, syncSessionStatus } from "@/lib/match-result";
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

    const [{ data: playSession, error: sessionError }, { data: attendances, error: attendanceError }] = await Promise.all([
      admin.from("play_sessions").select("id, session_date, status").eq("id", body.sessionId).single(),
      admin.from("attendances").select("member_id, drawn_number").eq("session_id", body.sessionId).in("drawn_number", allSlots),
    ]);
    if (sessionError) throw sessionError;
    if (attendanceError) throw attendanceError;
    if (!playSession) return Response.json({ error: "Không tìm thấy buổi chơi." }, { status: 404 });
    // Scores are only accepted once an admin has confirmed the schedule for this session.
    if (!["scheduled", "completed"].includes(String(playSession.status))) {
      return Response.json({ error: NOT_OPEN_ERROR }, { status: 400 });
    }

    const slotToMember = new Map((attendances || []).map((attendance) => [attendance.drawn_number, attendance.member_id]));
    const teamAIds = body.teamA.map((slot) => slotToMember.get(slot));
    const teamBIds = body.teamB.map((slot) => slotToMember.get(slot));
    if (teamAIds.some((id) => !id) || teamBIds.some((id) => !id)) {
      return Response.json({ error: "Một số trong lịch chưa có người bốc tương ứng." }, { status: 400 });
    }

    if (await isMonthClosed(admin, playSession.session_date)) return Response.json({ error: CLOSED_MONTH_ERROR }, { status: 400 });

    const { error: upsertError } = await admin.from("matches").upsert({
      session_id: body.sessionId,
      match_no: body.matchNo,
      match_type: body.matchType || null,
      team_a: teamAIds,
      team_b: teamBIds,
      score_a: scoreA,
      score_b: scoreB,
    }, { onConflict: "session_id,match_no" });
    if (upsertError) throw upsertError;

    await syncMonthlyResults(admin, monthStart(playSession.session_date));
    // ELO replays from the matches table, which is already written, so it can run alongside the status update.
    const [completed] = await Promise.all([syncSessionStatus(admin, body.sessionId, body.totalMatches), recalculateEloIfAvailable(admin)]);

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

    const result = await deleteMatchResult(admin, { sessionId: body.sessionId, matchNo: body.matchNo, totalMatches: body.totalMatches }, { recalculateElo: () => recalculateEloIfAvailable(admin) });
    if (result.error) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ ok: true, completed: false });
  } catch (error) {
    return jsonError(error);
  }
}
