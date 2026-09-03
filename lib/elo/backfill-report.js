import { ELO_ACCEPTANCE_TOLERANCE, ELO_INITIAL_RATING, ELO_K_FACTOR } from "./constants.js";
import { rankEloPlayers, replayEloMatches } from "./calculate-elo.js";
import { expectedHistoricalElo, historicalMatches, historicalPlayerNames } from "./historical-matches.js";

const roundOne = (value) => Math.round(Number(value) * 10) / 10;
const duplicateKey = (match) => `${match.date}:${match.sessionNumber}:${match.matchNumber}`;

export function validateHistoricalMatches(matches = historicalMatches, playerNames = historicalPlayerNames) {
  const knownPlayers = new Set(playerNames);
  const seen = new Set();
  const errors = [];

  for (const match of matches) {
    const key = duplicateKey(match);
    const players = [...(match.teamA || []), ...(match.teamB || [])];
    if (seen.has(key)) errors.push(`${key}: duplicate date/session/matchNumber.`);
    seen.add(key);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(match.date))) errors.push(`${key}: invalid date.`);
    if (!Number.isInteger(match.sessionNumber) || match.sessionNumber <= 0) errors.push(`${key}: invalid sessionNumber.`);
    if (!Number.isInteger(match.matchNumber) || match.matchNumber <= 0) errors.push(`${key}: invalid matchNumber.`);
    if (players.length !== 4) errors.push(`${key}: requires exactly four players.`);
    if (new Set(players).size !== 4) errors.push(`${key}: duplicate player in one match.`);
    if (Number(match.scoreA) === Number(match.scoreB)) errors.push(`${key}: tied score is not allowed.`);
    for (const player of players) {
      if (!knownPlayers.has(player)) errors.push(`${key}: unknown player "${player}".`);
    }
  }

  return errors;
}

export function buildHistoricalEloReport() {
  const validationErrors = validateHistoricalMatches();
  if (validationErrors.length) {
    return {
      ok: false,
      processedMatches: 0,
      players: historicalPlayerNames.length,
      validationErrors,
      rows: [],
    };
  }

  const replay = replayEloMatches({
    players: historicalPlayerNames.map((name) => ({ memberId: name, name, rating: ELO_INITIAL_RATING })),
    matches: historicalMatches,
    initialRating: ELO_INITIAL_RATING,
    kFactor: ELO_K_FACTOR,
  });

  const rows = rankEloPlayers(replay.ratings).map((row) => {
    const actual = roundOne(row.eloRating);
    const expected = expectedHistoricalElo[row.name];
    const diff = typeof expected === "number" ? roundOne(actual - expected) : null;
    const pass = typeof diff === "number" ? Math.abs(diff) <= ELO_ACCEPTANCE_TOLERANCE : false;
    return {
      name: row.name,
      rank: row.rank,
      level: row.level,
      matches: row.matches,
      actual,
      expected,
      diff,
      pass,
    };
  });

  return {
    ok: rows.every((row) => row.pass),
    processedMatches: replay.processedMatches,
    players: historicalPlayerNames.length,
    validationErrors: [],
    rows,
  };
}
