import assert from "node:assert/strict";
import test from "node:test";
import { analyze, attendance, bestPartners, buildStatsData, inRange, MIN_MATCHES, monthsWithMatches, pairKey, rangeBounds, rivals, winRate } from "../lib/stats.js";

const collator = new Intl.Collator("vi");
const nameOf = (id) => id.toUpperCase();
const match = (date, no, a, b, sa, sb, expA = 0.5) => ({ date, no, a, b, sa, sb, expA });

test("a pair is the same whichever order its players come in", () => {
  assert.equal(pairKey("b", "a"), pairKey("a", "b"));
});

test("close, deuce, blowout and upset wins follow the agreed thresholds", () => {
  const st = analyze([
    match("2026-11-07", 1, ["a", "b"], ["c", "d"], 21, 19),      // close (2 points)
    match("2026-11-07", 2, ["a", "c"], ["b", "d"], 23, 21),      // deuce (winner over 21), also close
    match("2026-11-07", 3, ["a", "d"], ["b", "c"], 21, 11),      // blowout (10 points)
    match("2026-11-07", 4, ["a", "b"], ["c", "d"], 21, 15, 0.3), // upset: A had a 30% chance
  ]);
  const a = st.person.a;
  assert.equal(a.m, 4);
  assert.equal(a.w, 4);
  assert.equal(a.closeW, 2);
  assert.equal(a.deuceW, 1);
  assert.equal(a.blowW, 1);
  assert.equal(a.upsetW, 1);
  assert.equal(st.person.d.closeL, 2);
  assert.equal(st.closeRate, 0.5);
  assert.deepEqual(st.buckets, [2, 0, 1, 1, 0]);
});

test("ELO right leaves out matches where both teams were rated the same", () => {
  const st = analyze([
    match("2026-11-07", 1, ["a", "b"], ["c", "d"], 21, 10, 0.5),
    match("2026-11-07", 2, ["a", "c"], ["b", "d"], 21, 10, 0.7),
    match("2026-11-07", 3, ["a", "d"], ["b", "c"], 10, 21, 0.6),
  ]);
  assert.equal(st.predicted, 2);
  assert.equal(st.eloRight, 0.5);
});

test("streaks run in date and match order", () => {
  const st = analyze([
    match("2026-11-07", 2, ["a", "b"], ["c", "d"], 21, 10),
    match("2026-10-31", 1, ["a", "b"], ["c", "d"], 10, 21),
    match("2026-11-07", 1, ["a", "c"], ["b", "d"], 21, 10),
    match("2026-11-07", 3, ["a", "d"], ["b", "c"], 21, 10),
  ]);
  assert.equal(st.person.a.bestStreak, 3);
  assert.deepEqual(st.person.a.current, { won: true, n: 3 });
  assert.deepEqual(st.person.b.current, { won: false, n: 1 });
});

test("chemistry is wins above what ELO expected, per match", () => {
  const st = analyze([
    match("2026-11-07", 1, ["a", "b"], ["c", "d"], 21, 10, 0.25),
    match("2026-11-14", 1, ["a", "b"], ["c", "d"], 21, 10, 0.25),
  ]);
  assert.equal(st.pair[pairKey("a", "b")].chem, 0.75);
  assert.equal(st.pair[pairKey("c", "d")].chem, -0.75);
});

test("a nemesis beats you more often than not, prey loses more often, both from MIN_MATCHES meetings", () => {
  const games = [];
  // a vs c: a loses 1–2; a vs d: a wins 2–1; a vs e: only twice
  // Each match brings in a different second opponent, so only c, d and e meet a more than once.
  games.push(match("2026-11-01", 1, ["a", "b"], ["c", "x1"], 10, 21), match("2026-11-01", 2, ["a", "b"], ["c", "x2"], 10, 21), match("2026-11-01", 3, ["a", "b"], ["c", "x3"], 21, 10));
  games.push(match("2026-11-08", 1, ["a", "b"], ["d", "x4"], 21, 10), match("2026-11-08", 2, ["a", "b"], ["d", "x5"], 21, 10), match("2026-11-08", 3, ["a", "b"], ["d", "x6"], 10, 21));
  games.push(match("2026-11-15", 1, ["a", "b"], ["e", "x7"], 10, 21), match("2026-11-15", 2, ["a", "b"], ["e", "x8"], 10, 21));
  const st = analyze(games);
  const { nemesis, prey } = rivals(st, "a", nameOf, collator);
  assert.ok(MIN_MATCHES === 3);
  assert.deepEqual(nemesis.map(([id]) => id), ["c"]);
  assert.deepEqual(prey.map(([id]) => id), ["d"]);
  assert.ok(!nemesis.some(([id]) => id === "e"), "two meetings are not enough");
  assert.ok(prey.every(([, x]) => winRate(x) > 0.5) && nemesis.every(([, x]) => winRate(x) < 0.5));
});

test("best partners won more than half their matches together, from MIN_MATCHES", () => {
  const st = analyze([
    match("2026-11-01", 1, ["a", "b"], ["c", "d"], 21, 10),
    match("2026-11-01", 2, ["a", "b"], ["c", "d"], 21, 10),
    match("2026-11-01", 3, ["a", "b"], ["c", "d"], 10, 21),
    match("2026-11-08", 1, ["a", "c"], ["b", "d"], 10, 21),
    match("2026-11-08", 2, ["a", "c"], ["b", "d"], 10, 21),
    match("2026-11-08", 3, ["a", "c"], ["b", "d"], 21, 10),
  ]);
  assert.deepEqual(bestPartners(st, "a", nameOf, collator).map(([id]) => id), ["b"]);
});

test("time ranges: this month, three months, one month", () => {
  const today = new Date(2026, 10, 14);
  assert.deepEqual(rangeBounds("month", today), { from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(rangeBounds("3m", today), { from: "2026-09-01", to: "2026-11-30" });
  assert.deepEqual(rangeBounds("m-2026-02", today), { from: "2026-02-01", to: "2026-02-28" });
  const data = { matches: [match("2026-08-29", 1, ["a", "b"], ["c", "d"], 21, 10), match("2026-09-05", 1, ["a", "b"], ["c", "d"], 21, 10)], sessions: [{ date: "2026-08-29", present: [] }, { date: "2026-09-05", present: [] }] };
  assert.equal(inRange(data, "3m", today).matches.length, 1);
  assert.deepEqual(monthsWithMatches(data.matches), ["2026-09", "2026-08"]);
});

test("attendance counts sessions from the day the member joined", () => {
  const sessions = [{ date: "2026-07-04", present: ["a"] }, { date: "2026-08-22", present: ["a", "b"] }, { date: "2026-08-29", present: ["a"] }];
  assert.deepEqual(attendance(sessions, "b", "2026-08-15"), { held: 2, came: 1, days: [{ date: "2026-08-22", came: true }, { date: "2026-08-29", came: false }] });
});

test("the server keeps only scored, decided matches and works out each team's expectation", () => {
  const data = buildStatsData({
    sessions: [{ id: "s1", session_date: "2026-11-07" }, { id: "s2", session_date: "2026-11-14" }],
    matches: [
      { id: "m1", session_id: "s1", match_no: 1, team_a: ["a", "b"], team_b: ["c", "d"], score_a: 21, score_b: 15 },
      { id: "m2", session_id: "s1", match_no: 2, team_a: ["a", "c"], team_b: ["b", "d"], score_a: null, score_b: null },
      { id: "m3", session_id: "s1", match_no: 3, team_a: ["a", "d"], team_b: ["b", "c"], score_a: 20, score_b: 20 },
      { id: "m4", session_id: "s2", match_no: 1, team_a: ["a", "b"], team_b: ["c", "d"], score_a: null, score_b: null },
    ],
    attendances: [{ session_id: "s1", member_id: "e", choice: "attending" }, { session_id: "s1", member_id: "f", choice: "absent" }],
    history: [
      { match_id: "m1", member_id: "a", elo_before: 1200, elo_after: 1210 },
      { match_id: "m1", member_id: "b", elo_before: 1000, elo_after: 1010 },
      { match_id: "m1", member_id: "c", elo_before: 1100, elo_after: 1090 },
      { match_id: "m1", member_id: "d", elo_before: 1100, elo_after: 1090 },
    ],
  });
  assert.deepEqual(data.matches.map((m) => m.id), ["m1"]);
  assert.equal(data.matches[0].expA, 0.5);
  assert.deepEqual(data.sessions.map((s) => s.date), ["2026-11-07"], "a session without a scored match is not counted yet");
  assert.deepEqual([...data.sessions[0].present].sort(), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(data.eloBySession, [{ date: "2026-11-07", r: { a: 1210, b: 1010, c: 1090, d: 1090 } }]);
});
