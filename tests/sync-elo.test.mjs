import assert from "node:assert/strict";
import test from "node:test";
import { computeEloState, writeEloInApplication } from "../lib/elo/sync-elo.js";

const profiles = () => ["a", "b", "c", "d", "e"].map((id) => ({ id, is_active: true, description: null, level: "2" }));
// Timestamps change on every write; the rest of a row must not.
const withoutTimes = (rows) => rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "updated_at" && key !== "created_at")));
const match = (id, matchNo, teamA, teamB, scoreA, scoreB) => ({ id, match_no: matchNo, team_a: teamA, team_b: teamB, score_a: scoreA, score_b: scoreB });
const sessions = () => [
  { session_date: "2026-11-14", status: "completed", matches: [match("m1", 1, ["a", "b"], ["c", "d"], 21, 10), match("m2", 2, ["a", "c"], ["b", "e"], 15, 21)] },
  { session_date: "2026-11-21", status: "scheduled", matches: [match("m3", 1, ["a", "e"], ["c", "d"], 21, 18), match("m4", 2, ["a", "b"], ["c", "d"], null, null)] },
  { session_date: "2026-11-28", status: "draft", matches: [match("m5", 1, ["a", "b"], ["c", "d"], 21, 5)] },
];

// In-memory stand-in for the Supabase calls writeEloInApplication makes.
function fakeAdmin(tables, { missingEloTables = false } = {}) {
  const writes = [];
  const missing = { data: null, error: { code: "42P01", message: 'relation "public.elo_history" does not exist' } };
  return {
    writes,
    from(table) {
      const filters = [];
      let action = "select";
      let values = null;
      let conflict = null;
      const run = async () => {
        if (missingEloTables && table.startsWith("elo_")) return missing;
        const rows = tables[table];
        const hit = (row) => filters.every((filter) => filter(row));
        if (action === "select") {
          if (table === "play_sessions") return { data: structuredClone(rows), error: null };
          return { data: rows.map((row) => ({ ...row })), error: null };
        }
        writes.push([action, table]);
        if (action === "update") { rows.filter(hit).forEach((row) => Object.assign(row, values)); return { error: null }; }
        if (action === "delete") { tables[table] = rows.filter((row) => !hit(row)); return { error: null }; }
        const keys = conflict.split(",");
        for (const value of values) {
          const existing = rows.find((row) => keys.every((key) => row[key] === value[key]));
          if (existing) Object.assign(existing, value);
          else rows.push({ id: `h${rows.length + 1}`, ...value });
        }
        return { error: null };
      };
      const builder = {
        select() { return builder; },
        order() { return builder; },
        eq(column, value) { filters.push((row) => row[column] === value); return builder; },
        in(column, list) { filters.push((row) => list.includes(row[column])); return builder; },
        update(next) { action = "update"; values = next; return builder; },
        delete() { action = "delete"; return builder; },
        upsert(next, options) { action = "upsert"; values = next; conflict = options.onConflict; return run(); },
        then(resolve, reject) { return run().then(resolve, reject); },
      };
      return builder;
    },
  };
}

test("counts every scored, decided match, whatever its session's status (as migration 010)", () => {
  const state = computeEloState({ profiles: profiles(), sessions: sessions() });
  assert.equal(state.processedMatches, 4);
  assert.deepEqual([...new Set(state.history.map((row) => row.match_id))], ["m1", "m2", "m3", "m5"]);
  assert.equal(state.history.length, 16);
  // Doubles ELO is zero-sum, so the ratings still add up to everyone's start.
  assert.ok(Math.abs(state.ratings.reduce((sum, row) => sum + row.elo_rating, 0) - 5000) < 0.001);
});

test("history rows chain: each player's next elo_before is their previous elo_after", () => {
  const { history, ratings } = computeEloState({ profiles: profiles(), sessions: sessions() });
  const last = new Map();
  for (const row of history) {
    assert.equal(row.elo_before, last.get(row.member_id) ?? 1000);
    assert.ok(Math.abs(row.elo_before + row.elo_change - row.elo_after) < 0.0002);
    last.set(row.member_id, row.elo_after);
  }
  for (const row of ratings) assert.equal(row.elo_rating, last.get(row.member_id) ?? 1000);
});

test("a member added later starts from the ELO kept in their profile", () => {
  const people = profiles();
  people[4].description = "[aemit-elo-start:950.5]";
  const { ratings } = computeEloState({ profiles: people, sessions: [] });
  assert.equal(ratings.find((row) => row.member_id === "e").elo_rating, 950.5);
  assert.equal(ratings.find((row) => row.member_id === "a").elo_rating, 1000);
});

test("top four by ELO are Level 1, inactive members get no level", () => {
  const people = profiles();
  people[4].is_active = false;
  const { levels } = computeEloState({ profiles: people, sessions: sessions() });
  assert.equal(levels.length, 4);
  assert.ok(levels.every((row) => row.level === "1"));
  assert.ok(!levels.some((row) => row.id === "e"));
});

test("writes ratings, history and levels from the matches, and a second run changes nothing", async () => {
  const tables = {
    profiles: profiles(),
    play_sessions: sessions(),
    elo_ratings: [{ member_id: "a", elo_rating: 1000 }],
    // m9 no longer exists or has no score: its rows must go.
    elo_history: [{ id: "old", match_id: "m9", member_id: "a", elo_before: 1000, elo_change: 16, elo_after: 1016 }],
  };
  const admin = fakeAdmin(tables);
  const result = await writeEloInApplication(admin);
  const expected = computeEloState({ profiles: profiles(), sessions: sessions() });

  assert.equal(result.processedMatches, 4);
  assert.deepEqual(tables.elo_ratings.map(({ member_id, elo_rating }) => ({ member_id, elo_rating })).sort((x, y) => x.member_id.localeCompare(y.member_id)),
    [...expected.ratings].sort((x, y) => x.member_id.localeCompare(y.member_id)));
  assert.equal(tables.elo_history.length, 16);
  assert.ok(!tables.elo_history.some((row) => row.match_id === "m9"));
  const levelById = new Map(tables.profiles.map((profile) => [profile.id, profile.level]));
  for (const row of expected.levels) assert.equal(levelById.get(row.id), row.level);

  const snapshot = () => JSON.stringify([tables.elo_ratings, tables.elo_history, tables.profiles].map(withoutTimes));
  const before = snapshot();
  admin.writes.length = 0;
  await writeEloInApplication(admin);
  const after = snapshot();
  assert.equal(after, before);
  assert.ok(!admin.writes.some(([action, table]) => table === "profiles" || action === "delete"));
});

test("without the ELO tables it still sets the levels", async () => {
  const tables = { profiles: profiles(), play_sessions: sessions() };
  await writeEloInApplication(fakeAdmin(tables, { missingEloTables: true }));
  assert.equal(tables.profiles.filter((profile) => profile.level === "1").length, 4);
});
