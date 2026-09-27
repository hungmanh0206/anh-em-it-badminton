import { ELO_INITIAL_RATING, ELO_K_FACTOR, ELO_LEVEL_ONE_SIZE, ELO_SCALE, ELO_SPLIT_FROM_DATE, ELO_SPLIT_GAP } from "./constants.js";

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const memberKey = (player) => String(player.memberId ?? player.name ?? "");

export function expectedScore(ratingA, ratingB, scale = ELO_SCALE) {
  return 1 / (1 + Math.pow(10, (toNumber(ratingB) - toNumber(ratingA)) / scale));
}

// Splits a team's total change (in integer tenths) between the two partners.
// strength = min(1, partner gap / splitGap): 0 = equal split, 1 = fully by individual expectation
// (winners: the lower-rated partner gets more; losers: the higher-rated partner loses more).
// The partner with the larger fractional part rounds up and the other takes the remainder,
// so the pair always sums to exactly `totalTenths`.
function splitTeamTenths(ratings, opponentAverage, won, totalTenths, splitGap, scale) {
  const weights = ratings.map((rating) => (won ? 1 - expectedScore(rating, opponentAverage, scale) : expectedScore(rating, opponentAverage, scale)));
  const strength = Math.min(1, Math.abs(ratings[0] - ratings[1]) / splitGap);
  const exact = weights.map((weight) => totalTenths * (strength * (weight / (weights[0] + weights[1])) + (1 - strength) * 0.5));
  const first = exact[0] - Math.floor(exact[0]) >= exact[1] - Math.floor(exact[1]) ? 0 : 1;
  const tenths = [0, 0];
  tenths[first] = Math.ceil(exact[first]);
  tenths[1 - first] = totalTenths - tenths[first];
  return tenths;
}

// splitGap = null keeps the original rule (both partners get the same delta); a number enables the
// zero-sum split: the team total comes from the team-average expectation, rounded once to 0.1,
// and the losing team loses exactly what the winning team gains.
export function calculateDoublesElo({ teamA, teamB, winner, kFactor = ELO_K_FACTOR, scale = ELO_SCALE, splitGap = null }) {
  if (!Array.isArray(teamA) || !Array.isArray(teamB) || teamA.length !== 2 || teamB.length !== 2) {
    throw new Error("ELO doubles match requires exactly two players per team.");
  }
  if (winner !== "A" && winner !== "B") throw new Error("Winner must be A or B.");

  const allPlayerIds = [...teamA, ...teamB].map(memberKey);
  if (new Set(allPlayerIds).size !== 4 || allPlayerIds.some((id) => !id)) {
    throw new Error("ELO doubles match requires four distinct players.");
  }

  const averageA = teamA.reduce((sum, player) => sum + toNumber(player.rating, ELO_INITIAL_RATING), 0) / 2;
  const averageB = teamB.reduce((sum, player) => sum + toNumber(player.rating, ELO_INITIAL_RATING), 0) / 2;
  const expectedA = expectedScore(averageA, averageB, scale);
  const expectedB = 1 - expectedA;
  const scoreA = winner === "A" ? 1 : 0;
  const scoreB = winner === "B" ? 1 : 0;
  const nextPlayers = (players, deltas) => players.map((player, index) => {
    const ratingBefore = toNumber(player.rating, ELO_INITIAL_RATING);
    const delta = deltas[index];
    const ratingAfter = ratingBefore + delta;
    return {
      ...player,
      ratingBefore,
      rating: ratingAfter,
      ratingAfter,
      delta,
    };
  });

  let deltasA;
  let deltasB;
  if (splitGap === null || splitGap === undefined) {
    const deltaA = kFactor * (scoreA - expectedA);
    const deltaB = kFactor * (scoreB - expectedB);
    deltasA = [deltaA, deltaA];
    deltasB = [deltaB, deltaB];
  } else {
    const aWon = winner === "A";
    const winnerExpected = aWon ? expectedA : expectedB;
    const totalTenths = Math.round(2 * kFactor * (1 - winnerExpected) * 10);
    const ratingsA = teamA.map((player) => toNumber(player.rating, ELO_INITIAL_RATING));
    const ratingsB = teamB.map((player) => toNumber(player.rating, ELO_INITIAL_RATING));
    const tenthsA = splitTeamTenths(ratingsA, averageB, aWon, totalTenths, splitGap, scale);
    const tenthsB = splitTeamTenths(ratingsB, averageA, !aWon, totalTenths, splitGap, scale);
    const sign = (won) => (won ? 1 : -1);
    deltasA = tenthsA.map((tenths) => (sign(aWon) * tenths) / 10);
    deltasB = tenthsB.map((tenths) => (sign(!aWon) * tenths) / 10);
  }

  return {
    teamA: {
      average: averageA,
      expected: expectedA,
      delta: (deltasA[0] + deltasA[1]) / 2,
      players: nextPlayers(teamA, deltasA),
    },
    teamB: {
      average: averageB,
      expected: expectedB,
      delta: (deltasB[0] + deltasB[1]) / 2,
      players: nextPlayers(teamB, deltasB),
    },
  };
}

// Matches before ELO_SPLIT_FROM_DATE keep the original equal split so existing ratings never change.
export const splitGapForMatchDate = (date, splitFromDate = ELO_SPLIT_FROM_DATE, splitGap = ELO_SPLIT_GAP) =>
  splitFromDate && String(date ?? "") >= splitFromDate ? splitGap : null;

export function winnerFromScore(scoreA, scoreB) {
  const a = toNumber(scoreA, Number.NaN);
  const b = toNumber(scoreB, Number.NaN);
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error("Scores must be valid numbers.");
  if (a === b) throw new Error("ELO match score cannot be tied.");
  return a > b ? "A" : "B";
}

export function compareEloMatchOrder(a, b) {
  return String(a.date).localeCompare(String(b.date)) ||
    toNumber(a.sessionNumber) - toNumber(b.sessionNumber) ||
    toNumber(a.matchNumber) - toNumber(b.matchNumber) ||
    String(a.id ?? "").localeCompare(String(b.id ?? ""));
}

export function rankEloPlayers(players, levelOneSize = ELO_LEVEL_ONE_SIZE) {
  return [...players]
    .sort((a, b) =>
      toNumber(b.eloRating, ELO_INITIAL_RATING) - toNumber(a.eloRating, ELO_INITIAL_RATING) ||
      String(a.memberId ?? a.name ?? "").localeCompare(String(b.memberId ?? b.name ?? ""), "vi")
    )
    .map((player, index) => ({
      ...player,
      rank: index + 1,
      level: index < levelOneSize ? 1 : 2,
    }));
}

export function replayEloMatches({ players, matches, initialRating = ELO_INITIAL_RATING, kFactor = ELO_K_FACTOR, strictDuplicateIds = true, splitFromDate = ELO_SPLIT_FROM_DATE, splitGap = ELO_SPLIT_GAP }) {
  if (!Array.isArray(players) || !players.length) throw new Error("ELO replay requires players.");
  if (!Array.isArray(matches)) throw new Error("ELO replay requires matches.");

  const ratings = new Map();
  const playerMeta = new Map();
  const matchCounts = new Map();
  for (const player of players) {
    const id = memberKey(player);
    if (!id) throw new Error("Player must have memberId or name.");
    ratings.set(id, toNumber(player.rating, initialRating));
    playerMeta.set(id, { ...player, memberId: id });
    matchCounts.set(id, 0);
  }

  const processed = new Set();
  const history = [];
  const sortedMatches = [...matches].sort(compareEloMatchOrder);

  for (const match of sortedMatches) {
    const matchId = String(match.id ?? `${match.date}:${match.sessionNumber ?? 0}:${match.matchNumber}`);
    if (processed.has(matchId)) {
      if (strictDuplicateIds) throw new Error(`Duplicate ELO match id: ${matchId}`);
      continue;
    }
    processed.add(matchId);

    if (!Array.isArray(match.teamA) || !Array.isArray(match.teamB) || match.teamA.length !== 2 || match.teamB.length !== 2) {
      throw new Error(`Invalid ELO teams at match ${matchId}.`);
    }
    const teamAIds = match.teamA.map(String);
    const teamBIds = match.teamB.map(String);
    const allIds = [...teamAIds, ...teamBIds];
    if (new Set(allIds).size !== 4) throw new Error(`Duplicate player in ELO match ${matchId}.`);

    for (const id of allIds) {
      if (!ratings.has(id)) ratings.set(id, initialRating);
      if (!playerMeta.has(id)) playerMeta.set(id, { memberId: id, name: id });
      if (!matchCounts.has(id)) matchCounts.set(id, 0);
    }

    const result = calculateDoublesElo({
      teamA: teamAIds.map((id) => ({ ...playerMeta.get(id), memberId: id, rating: ratings.get(id) })),
      teamB: teamBIds.map((id) => ({ ...playerMeta.get(id), memberId: id, rating: ratings.get(id) })),
      winner: match.winner ?? winnerFromScore(match.scoreA, match.scoreB),
      kFactor,
      splitGap: splitGapForMatchDate(match.date, splitFromDate, splitGap),
    });

    for (const player of result.teamA.players) {
      ratings.set(player.memberId, player.ratingAfter);
      matchCounts.set(player.memberId, (matchCounts.get(player.memberId) ?? 0) + 1);
      history.push({ matchId, match, team: "A", memberId: player.memberId, eloBefore: player.ratingBefore, eloChange: player.delta, eloAfter: player.ratingAfter });
    }
    for (const player of result.teamB.players) {
      ratings.set(player.memberId, player.ratingAfter);
      matchCounts.set(player.memberId, (matchCounts.get(player.memberId) ?? 0) + 1);
      history.push({ matchId, match, team: "B", memberId: player.memberId, eloBefore: player.ratingBefore, eloChange: player.delta, eloAfter: player.ratingAfter });
    }
  }

  const ratingRows = [...ratings.entries()].map(([memberId, eloRating]) => {
    const meta = playerMeta.get(memberId) ?? { memberId };
    return {
      ...meta,
      memberId,
      eloRating,
      matches: matchCounts.get(memberId) ?? 0,
    };
  });

  return {
    ratings: rankEloPlayers(ratingRows),
    history,
    processedMatches: processed.size,
  };
}
