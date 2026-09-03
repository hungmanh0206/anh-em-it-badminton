import { ELO_INITIAL_RATING, ELO_K_FACTOR, ELO_LEVEL_ONE_SIZE, ELO_SCALE } from "./constants.js";

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const memberKey = (player) => String(player.memberId ?? player.name ?? "");

export function expectedScore(ratingA, ratingB, scale = ELO_SCALE) {
  return 1 / (1 + Math.pow(10, (toNumber(ratingB) - toNumber(ratingA)) / scale));
}

export function calculateDoublesElo({ teamA, teamB, winner, kFactor = ELO_K_FACTOR, scale = ELO_SCALE }) {
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
  const deltaA = kFactor * (scoreA - expectedA);
  const deltaB = kFactor * (scoreB - expectedB);

  const nextPlayers = (players, delta) => players.map((player) => {
    const ratingBefore = toNumber(player.rating, ELO_INITIAL_RATING);
    const ratingAfter = ratingBefore + delta;
    return {
      ...player,
      ratingBefore,
      rating: ratingAfter,
      ratingAfter,
      delta,
    };
  });

  return {
    teamA: {
      average: averageA,
      expected: expectedA,
      delta: deltaA,
      players: nextPlayers(teamA, deltaA),
    },
    teamB: {
      average: averageB,
      expected: expectedB,
      delta: deltaB,
      players: nextPlayers(teamB, deltaB),
    },
  };
}

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

export function replayEloMatches({ players, matches, initialRating = ELO_INITIAL_RATING, kFactor = ELO_K_FACTOR, strictDuplicateIds = true }) {
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
