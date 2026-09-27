import assert from "node:assert/strict";
import test from "node:test";
import { calculateDoublesElo, rankEloPlayers, replayEloMatches } from "../lib/elo/calculate-elo.js";
import { ELO_ACCEPTANCE_TOLERANCE, ELO_SPLIT_FROM_DATE, ELO_SPLIT_GAP } from "../lib/elo/constants.js";
import { buildHistoricalEloReport } from "../lib/elo/backfill-report.js";

const team = (prefix, rating) => [
  { memberId: `${prefix}1`, rating },
  { memberId: `${prefix}2`, rating },
];

test("equal doubles teams gain and lose 16 ELO when Team A wins", () => {
  const result = calculateDoublesElo({ teamA: team("A", 1000), teamB: team("B", 1000), winner: "A" });
  assert.equal(result.teamA.expected, 0.5);
  assert.equal(result.teamB.expected, 0.5);
  assert.equal(result.teamA.delta, 16);
  assert.equal(result.teamB.delta, -16);
});

test("underdog win gains more ELO than equal-rating win", () => {
  const result = calculateDoublesElo({ teamA: team("A", 900), teamB: team("B", 1100), winner: "A" });
  assert.ok(result.teamA.delta > 16);
  assert.ok(result.teamB.delta < -16);
});

test("favorite win gains less ELO than equal-rating win", () => {
  const result = calculateDoublesElo({ teamA: team("A", 1100), teamB: team("B", 900), winner: "A" });
  assert.ok(result.teamA.delta > 0);
  assert.ok(result.teamA.delta < 16);
});

test("all four players update and teammates receive the same delta", () => {
  const result = calculateDoublesElo({ teamA: team("A", 1000), teamB: team("B", 1000), winner: "B" });
  assert.equal(result.teamA.players.length + result.teamB.players.length, 4);
  assert.equal(result.teamA.players[0].delta, result.teamA.players[1].delta);
  assert.equal(result.teamB.players[0].delta, result.teamB.players[1].delta);
  assert.ok(Math.abs((2 * result.teamA.delta) + (2 * result.teamB.delta)) < 1e-9);
});

test("duplicate match ids are rejected so one match cannot be replayed twice by accident", () => {
  const players = ["A1", "A2", "B1", "B2"].map((memberId) => ({ memberId }));
  const match = { id: "same-match", date: "2026-07-04", sessionNumber: 1, matchNumber: 1, teamA: ["A1", "A2"], teamB: ["B1", "B2"], scoreA: 21, scoreB: 19 };
  assert.throws(() => replayEloMatches({ players, matches: [match, match] }), /Duplicate ELO match id/);
});

test("replay sorts matches chronologically before applying ELO", () => {
  const players = ["A1", "A2", "B1", "B2"].map((memberId) => ({ memberId }));
  const later = { id: "later", date: "2026-07-11", sessionNumber: 2, matchNumber: 1, teamA: ["A1", "A2"], teamB: ["B1", "B2"], scoreA: 21, scoreB: 19 };
  const earlier = { id: "earlier", date: "2026-07-04", sessionNumber: 1, matchNumber: 1, teamA: ["A1", "A2"], teamB: ["B1", "B2"], scoreA: 18, scoreB: 21 };
  const replay = replayEloMatches({ players, matches: [later, earlier] });
  assert.equal(replay.history[0].matchId, "earlier");
});

test("Top 4 ELO become Level 1 with deterministic tie-break", () => {
  const ranked = rankEloPlayers([
    { memberId: "d", name: "D", eloRating: 1000 },
    { memberId: "a", name: "A", eloRating: 1100 },
    { memberId: "b", name: "B", eloRating: 1000 },
    { memberId: "c", name: "C", eloRating: 1000 },
    { memberId: "e", name: "E", eloRating: 900 },
  ]);
  assert.deepEqual(ranked.map((row) => row.memberId), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(ranked.map((row) => row.level), [1, 1, 1, 1, 2]);
});

test("historical July-August backfill matches the acceptance table", () => {
  const report = buildHistoricalEloReport();
  assert.equal(report.processedMatches, 62);
  assert.equal(report.validationErrors.length, 0);
  for (const row of report.rows) {
    assert.ok(Math.abs(row.diff) <= ELO_ACCEPTANCE_TOLERANCE, `${row.name}: actual ${row.actual}, expected ${row.expected}, diff ${row.diff}`);
  }
});

// ---- Zero-sum split inside each team (ELO_SPLIT_GAP), used from ELO_SPLIT_FROM_DATE ----
const withRatings = (ratings) => ratings.map((rating, index) => ({ memberId: `P${index}`, rating }));
const splitMatch = (a, b, winner) => calculateDoublesElo({ teamA: withRatings(a), teamB: withRatings(b).map((p, i) => ({ ...p, memberId: `Q${i}` })), winner, splitGap: ELO_SPLIT_GAP });
const deltasOf = (result) => [...result.teamA.players, ...result.teamB.players].map((player) => player.delta);
const tenthsSum = (values) => values.reduce((sum, value) => sum + Math.round(value * 10), 0);

test("split rule: Mạnh 756.6 + Thành 1191.5 beat Quý 1163.1 + Nam 916.3", () => {
  assert.deepEqual(deltasOf(splitMatch([756.6, 1191.5], [1163.1, 916.3], "A")), [21, 17, -19.7, -18.3]);
});

test("split rule: Mạnh 756.6 + Thành 1191.5 lose to Quý 1163.1 + Nam 916.3", () => {
  assert.deepEqual(deltasOf(splitMatch([756.6, 1191.5], [1163.1, 916.3], "B")), [-11.2, -14.8, 12.4, 13.6]);
});

test("split rule: equal partners still share equally", () => {
  assert.deepEqual(deltasOf(splitMatch([1000, 1000], [1000, 1000], "A")), [16, 16, -16, -16]);
});

test("split rule: every match is exactly zero-sum in 0.1 units", () => {
  let seed = 7;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let i = 0; i < 2000; i++) {
    const r = () => Math.round((700 + rand() * 700) * 10) / 10;
    const result = splitMatch([r(), r()], [r(), r()], rand() < 0.5 ? "A" : "B");
    const deltas = deltasOf(result);
    assert.equal(tenthsSum(deltas), 0);
    deltas.forEach((delta) => assert.equal(Math.round(delta * 10), delta * 10));
  }
});

test("split rule: winners' lower-rated partner gains more, losers' higher-rated partner loses more", () => {
  const [low, high, loserHigh, loserLow] = deltasOf(splitMatch([800, 1200], [1150, 950], "A"));
  assert.ok(low > high);
  assert.ok(loserHigh < loserLow);
});

test("matches before ELO_SPLIT_FROM_DATE keep the equal split; later matches use the split rule", () => {
  const players = [{ memberId: "A1", rating: 800 }, { memberId: "A2", rating: 1200 }, { memberId: "B1", rating: 1000 }, { memberId: "B2", rating: 1000 }];
  const match = (id, date) => ({ id, date, sessionNumber: 0, matchNumber: 1, teamA: ["A1", "A2"], teamB: ["B1", "B2"], scoreA: 21, scoreB: 15 });
  const before = replayEloMatches({ players, matches: [match("old", "2026-09-26")] }).history.filter((row) => row.team === "A");
  assert.equal(before[0].eloChange, before[1].eloChange);
  const after = replayEloMatches({ players, matches: [match("new", ELO_SPLIT_FROM_DATE)] }).history.filter((row) => row.team === "A");
  assert.notEqual(after[0].eloChange, after[1].eloChange);
});
