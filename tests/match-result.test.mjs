import assert from "node:assert/strict";
import test from "node:test";
import { deleteMatchResult, monthlyTotalsFromMatches, monthStart, nextMonthStart, sessionHasResults, syncMonthlyResults, syncSessionStatus } from "../lib/match-result.js";

// In-memory stand-in for the few Supabase calls the delete flow makes.
function fakeAdmin(tables, { failUpdateOn, beforeWrite } = {}) {
  const log = [];
  const client = {
    log,
    from(table) {
      const filters = [];
      let action = "select";
      let values = null;
      const matches = (row) => filters.every((filter) => filter(row));
      const run = async () => {
        if (action !== "select") await beforeWrite?.(table, action);
        if (action === "update" && failUpdateOn?.(table, values)) return { error: { message: "write failed" } };
        if (action === "upsert") {
          for (const value of values) {
            const existing = tables[table].find((row) => row.month === value.month && row.member_id === value.member_id);
            if (existing) Object.assign(existing, value);
            else tables[table].push({ id: `new-${value.member_id}`, created_at: "z", ...value });
          }
          log.push(["upsert", table, values.length]);
          return { error: null };
        }
        if (action === "delete") {
          const before = tables[table].length;
          tables[table] = tables[table].filter((row) => !matches(row));
          log.push(["delete", table, before - tables[table].length]);
          return { error: null };
        }
        if (action === "update") {
          tables[table].filter(matches).forEach((row) => Object.assign(row, values));
          log.push(["update", table, values]);
          return { error: null };
        }
        let rows = tables[table].filter(matches);
        if (table === "play_sessions") rows = rows.map((row) => ({ ...row, matches: tables.matches.filter((match) => match.session_id === row.id) }));
        return { data: rows, count: rows.length, error: null };
      };
      const query = {
        select: () => query,
        delete: () => { action = "delete"; return query; },
        update: (next) => { action = "update"; values = next; return query; },
        upsert: (next) => { action = "upsert"; values = next; return query; },
        in: (column, list) => { filters.push((row) => list.includes(row[column])); return query; },
        eq: (column, value) => { filters.push((row) => row[column] === value); return query; },
        gt: (column, value) => { filters.push((row) => row[column] > value); return query; },
        gte: (column, value) => { filters.push((row) => row[column] >= value); return query; },
        lt: (column, value) => { filters.push((row) => row[column] < value); return query; },
        single: async () => { const result = await run(); return { data: result.data?.[0] ?? null, error: result.error }; },
        then: (resolve, reject) => Promise.resolve().then(run).then(resolve, reject),
      };
      return query;
    },
  };
  return client;
}

const match = (id, session_id, match_no, team_a, team_b, score_a, score_b) => ({ id, session_id, match_no, team_a, team_b, score_a, score_b });

// Two matches saved in s1 (A,B beat C,D 21-15; C,E beat A,B 21-19) and one earlier in the month.
function october(status = "scheduled") {
  const matches = [
    match("m0", "s0", 1, ["A", "E"], ["B", "D"], 21, 10),
    match("m1", "s1", 1, ["A", "B"], ["C", "D"], 21, 15),
    match("m2", "s1", 2, ["C", "E"], ["A", "B"], 21, 19),
    match("x1", "other", 1, ["A", "B"], ["C", "D"], 21, 0),
  ];
  const sessions = [
    { id: "s0", session_date: "2026-10-03", status: "completed" },
    { id: "s1", session_date: "2026-10-10", status },
    { id: "other", session_date: "2026-09-05", status: "completed" },
  ];
  const october = matches.filter((row) => row.id !== "x1");
  const totals = monthlyTotalsFromMatches(october);
  const monthly = [...totals].map(([member_id, value], index) => ({ id: `r${index}`, month: "2026-10-01", member_id, rank: index + 1, total_points: value.total, points_for: value.for, points_against: value.against, point_diff: value.for - value.against, matches_played: value.matches, created_at: `2026-10-0${index + 1}` }));
  monthly.push({ id: "sep", month: "2026-09-01", member_id: "A", rank: 1, total_points: 7, points_for: 7, points_against: 7, point_diff: 0, matches_played: 7, created_at: "x" });
  const profiles = ["A", "B", "C", "D", "E", "F"].map((id) => ({ id, level: id === "F" ? "1" : "2" }));
  return { play_sessions: sessions, matches, monthly_results: monthly, profiles };
}

const row = (tables, memberId) => tables.monthly_results.find((item) => item.member_id === memberId && item.month === "2026-10-01");
const noElo = async () => {};
const expectedAfterDeletingM1 = (tables) => monthlyTotalsFromMatches(tables.matches.filter((item) => item.id !== "x1"));

test("month keys are right across the year end", () => {
  assert.equal(nextMonthStart("2026-12-05"), "2027-01-01");
  assert.equal(nextMonthStart("2026-12-01"), "2027-01-01");
  assert.equal(nextMonthStart("2026-10-31"), "2026-11-01");
  assert.equal(nextMonthStart("2026-01-31"), "2026-02-01");
  assert.equal(monthStart("2026-12-05"), "2026-12-01");
});

test("totals count wins, points and matches for both teams and skip unscored matches", () => {
  const totals = monthlyTotalsFromMatches([match("a", "s", 1, ["A", "B"], ["C", "D"], 21, 15), match("b", "s", 2, ["A", "C"], ["B", "D"], null, null)]);
  assert.deepEqual(totals.get("A"), { total: 1, for: 21, against: 15, matches: 1 });
  assert.deepEqual(totals.get("D"), { total: 0, for: 15, against: 21, matches: 1 });
});

test("deleting a result restores every player's month exactly", () => {
  const tables = october();
  const admin = fakeAdmin(tables);
  return deleteMatchResult(admin, { sessionId: "s1", matchNo: 1 }, { recalculateElo: noElo }).then((result) => {
    assert.deepEqual(result, { ok: true });
    assert.equal(tables.matches.some((item) => item.id === "m1"), false);
    assert.equal(tables.matches.some((item) => item.id === "m2"), true);
    const expected = expectedAfterDeletingM1(tables);
    for (const member of ["A", "B", "C", "D", "E"]) {
      const current = row(tables, member);
      const totals = expected.get(member);
      assert.deepEqual([current.total_points, current.points_for, current.points_against, current.matches_played, current.point_diff], [totals.total, totals.for, totals.against, totals.matches, totals.for - totals.against], member);
    }
    assert.deepEqual([row(tables, "A").total_points, row(tables, "A").points_for, row(tables, "A").points_against, row(tables, "A").matches_played], [1, 40, 31, 2]);
  });
});

test("other months and other sessions are untouched", async () => {
  const tables = october();
  await deleteMatchResult(fakeAdmin(tables), { sessionId: "s1", matchNo: 1 }, { recalculateElo: noElo });
  assert.equal(tables.monthly_results.find((item) => item.id === "sep").total_points, 7);
  assert.equal(tables.matches.some((item) => item.id === "x1"), true);
  assert.equal(tables.matches.some((item) => item.id === "m0"), true);
});

test("deleting twice, or from two devices at once, removes the result only once", async () => {
  const tables = october();
  const admin = fakeAdmin(tables);
  await Promise.all([1, 2].map(() => deleteMatchResult(admin, { sessionId: "s1", matchNo: 1 }, { recalculateElo: noElo })));
  const afterBoth = structuredClone(tables.monthly_results);
  await deleteMatchResult(admin, { sessionId: "s1", matchNo: 1 }, { recalculateElo: noElo });
  assert.deepEqual(tables.monthly_results, afterBoth);
  assert.equal(row(tables, "C").matches_played, 1);
  assert.equal(row(tables, "C").total_points, 1);
});

test("a retry repairs a delete that failed part way, and ELO always runs", async () => {
  const tables = october();
  const failing = fakeAdmin(tables, { failUpdateOn: (table, values) => table === "monthly_results" && values.matches_played !== undefined });
  await assert.rejects(deleteMatchResult(failing, { sessionId: "s1", matchNo: 1 }, { recalculateElo: noElo }));
  assert.equal(tables.matches.some((item) => item.id === "m1"), false);
  assert.equal(row(tables, "A").matches_played, 3);

  let eloRuns = 0;
  await deleteMatchResult(fakeAdmin(tables), { sessionId: "s1", matchNo: 1 }, { recalculateElo: async () => { eloRuns += 1; } });
  assert.equal(row(tables, "A").matches_played, 2);
  assert.equal(eloRuns, 1);
});

test("a member left with no matches drops out of the ranking", async () => {
  const tables = october();
  await deleteMatchResult(fakeAdmin(tables), { sessionId: "s1", matchNo: 2 }, { recalculateElo: noElo });
  await deleteMatchResult(fakeAdmin(tables), { sessionId: "s1", matchNo: 1 }, { recalculateElo: noElo });
  await deleteMatchResult(fakeAdmin(tables), { sessionId: "s0", matchNo: 1 }, { recalculateElo: noElo });
  const current = row(tables, "C");
  assert.deepEqual([current.total_points, current.points_for, current.points_against, current.point_diff, current.matches_played, current.rank], [0, 0, 0, 0, 0, 999]);
});

test("ranks are recalculated after a delete", async () => {
  const tables = october();
  await deleteMatchResult(fakeAdmin(tables), { sessionId: "s1", matchNo: 1 }, { recalculateElo: noElo });
  const ranked = tables.monthly_results.filter((item) => item.month === "2026-10-01" && item.matches_played > 0).sort((a, b) => a.rank - b.rank);
  assert.deepEqual(ranked.map((item) => item.rank), ranked.map((_, index) => index + 1));
  for (let index = 1; index < ranked.length; index += 1) assert.ok(ranked[index - 1].total_points >= ranked[index].total_points);
});

test("a finished session reopens and an open one stays open", async () => {
  const finished = october("completed");
  await deleteMatchResult(fakeAdmin(finished), { sessionId: "s1", matchNo: 1, totalMatches: 2 }, { recalculateElo: noElo });
  assert.equal(finished.play_sessions.find((item) => item.id === "s1").status, "scheduled");

  const open = october("scheduled");
  await deleteMatchResult(fakeAdmin(open), { sessionId: "s1", matchNo: 1, totalMatches: 2 }, { recalculateElo: noElo });
  assert.equal(open.play_sessions.find((item) => item.id === "s1").status, "scheduled");
});

test("session status follows the saved results", async () => {
  const tables = october("scheduled");
  const admin = fakeAdmin(tables);
  assert.equal(await syncSessionStatus(admin, "s1", 3), false);
  assert.equal(await syncSessionStatus(admin, "s1", 2), true);
  assert.equal(tables.play_sessions.find((item) => item.id === "s1").status, "completed");
  assert.equal(await syncSessionStatus(admin, "s1", undefined), false);
});

test("a result deleted while the status is being written cannot leave the session completed", async () => {
  const tables = october("scheduled");
  let deleted = false;
  const admin = fakeAdmin(tables, {
    beforeWrite: async (table) => {
      if (table !== "play_sessions" || deleted) return;
      deleted = true;
      tables.matches = tables.matches.filter((item) => item.id !== "m1");
    },
  });
  assert.equal(await syncSessionStatus(admin, "s1", 2), false);
  assert.equal(tables.play_sessions.find((item) => item.id === "s1").status, "scheduled");
});

test("a request overlapping another one still ends with the right ranking", async () => {
  const tables = october();
  tables.matches.push(match("m3", "s1", 3, ["A", "E"], ["C", "D"], 21, 5));
  let overlapped = false;
  const admin = fakeAdmin(tables, {
    beforeWrite: async (table, action) => {
      if (table !== "monthly_results" || overlapped || action === "delete") return;
      overlapped = true;
      // After this request has read the matches, another one saves a new match and finishes first.
      tables.matches.push(match("m4", "s1", 4, ["B", "C"], ["D", "E"], 21, 7));
      await syncMonthlyResults(fakeAdmin(tables), "2026-10-01");
    },
  });
  await syncMonthlyResults(admin, "2026-10-01");
  const expected = monthlyTotalsFromMatches(tables.matches.filter((item) => item.id !== "x1"));
  for (const member of ["A", "B", "C", "D", "E"]) {
    const current = row(tables, member);
    const totals = expected.get(member);
    assert.deepEqual([current.total_points, current.points_for, current.points_against, current.matches_played], [totals.total, totals.for, totals.against, totals.matches], member);
  }
});

test("saving a member's first match of the month creates their row", async () => {
  const tables = october();
  tables.matches.push(match("m5", "s1", 3, ["F", "A"], ["C", "D"], 21, 12));
  await syncMonthlyResults(fakeAdmin(tables), "2026-10-01");
  const created = row(tables, "F");
  assert.deepEqual([created.total_points, created.points_for, created.points_against, created.point_diff, created.matches_played, created.level_next_month], [1, 21, 12, 9, 1, "1"]);
  assert.ok(created.rank >= 1 && created.rank <= 6);
});

test("re-saving a match with a new score replaces its old result", async () => {
  const tables = october();
  const saved = tables.matches.find((item) => item.id === "m1");
  saved.score_a = 15;
  saved.score_b = 21;
  await syncMonthlyResults(fakeAdmin(tables), "2026-10-01");
  assert.deepEqual([row(tables, "A").total_points, row(tables, "A").points_for, row(tables, "A").points_against, row(tables, "A").matches_played], [1, 55, 52, 3]);
  assert.deepEqual([row(tables, "C").total_points, row(tables, "C").points_for, row(tables, "C").matches_played], [2, 42, 2]);
});

test("removing a whole session takes its results out of the ranking (attendance change, Home reset)", async () => {
  const tables = october();
  const admin = fakeAdmin(tables);
  assert.equal(await sessionHasResults(admin, "s1"), true);
  tables.matches = tables.matches.filter((item) => item.session_id !== "s1");
  await syncMonthlyResults(admin, "2026-10-01");
  assert.equal(await sessionHasResults(admin, "s1"), false);
  assert.deepEqual([row(tables, "A").total_points, row(tables, "A").points_for, row(tables, "A").matches_played], [1, 21, 1]);
  assert.deepEqual([row(tables, "C").total_points, row(tables, "C").points_for, row(tables, "C").matches_played, row(tables, "C").rank], [0, 0, 0, 999]);
  assert.equal(tables.monthly_results.find((item) => item.id === "sep").total_points, 7);
});

test("syncing an already correct month writes nothing", async () => {
  const tables = october();
  const admin = fakeAdmin(tables);
  await syncMonthlyResults(admin, "2026-10-01");
  const writesAfterFirst = admin.log.length;
  await syncMonthlyResults(admin, "2026-10-01");
  assert.equal(admin.log.length, writesAfterFirst);
});

test("a closed month and an unconfirmed schedule refuse the delete and change nothing", async () => {
  const closed = october();
  closed.monthly_results.push({ id: "n2", month: "2026-11-01", member_id: "B" });
  const snapshot = structuredClone(closed);
  const refused = await deleteMatchResult(fakeAdmin(closed), { sessionId: "s1", matchNo: 1 }, { recalculateElo: noElo });
  assert.equal(refused.status, 400);
  assert.deepEqual(closed, snapshot);

  const draft = october("drawn");
  assert.equal((await deleteMatchResult(fakeAdmin(draft), { sessionId: "s1", matchNo: 1 }, { recalculateElo: noElo })).status, 400);
  assert.equal(draft.matches.some((item) => item.id === "m1"), true);
});

test("December sessions can be deleted (the closed-month check asks about January)", async () => {
  const tables = {
    play_sessions: [{ id: "dec", session_date: "2026-12-05", status: "scheduled" }],
    matches: [match("d1", "dec", 1, ["A", "B"], ["C", "D"], 21, 15)],
    monthly_results: ["A", "B", "C", "D"].map((member_id, index) => ({ id: `d${index}`, month: "2026-12-01", member_id, rank: index + 1, total_points: index < 2 ? 1 : 0, points_for: index < 2 ? 21 : 15, points_against: index < 2 ? 15 : 21, point_diff: 0, matches_played: 1, created_at: "x" })),
  };
  assert.deepEqual(await deleteMatchResult(fakeAdmin(tables), { sessionId: "dec", matchNo: 1 }, { recalculateElo: noElo }), { ok: true });
  assert.equal(tables.monthly_results[0].matches_played, 0);
  tables.monthly_results.push({ id: "jan", month: "2027-01-01", member_id: "A" });
  tables.matches.push(match("d2", "dec", 2, ["A", "B"], ["C", "D"], 21, 15));
  assert.equal((await deleteMatchResult(fakeAdmin(tables), { sessionId: "dec", matchNo: 2 }, { recalculateElo: noElo })).status, 400);
});
