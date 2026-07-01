// Scores routes and picks the "top 3" cards, given routes that already carry
// { tollCost, driveTimeMinutes, preference }.
// score = tollCost + (driveTimeMinutes/60 * hourlyRate). Lower is better.

function scoreRoutes(routes, hourlyRate) {
  const scored = routes.map(route => {
    const driveTimeHours = route.driveTimeMinutes !== null ? route.driveTimeMinutes / 60 : null;
    const timeCost = driveTimeHours !== null ? driveTimeHours * hourlyRate : null;
    const score = timeCost !== null ? parseFloat((route.tollCost + timeCost).toFixed(2)) : null;
    return { ...route, timeCost, score };
  });

  scored.sort((a, b) => {
    if (a.score === null && b.score === null) return 0;
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return a.score - b.score;
  });

  return scored.map((route, i) => ({ ...route, rank: i + 1 }));
}

// Suppresses routes that are too similar to a higher-preference route already
// being shown — within minuteThreshold minutes AND dollarThreshold dollars.
// Processes candidates in preference order (highest first) and only compares
// each one against routes already kept, rather than clustering transitively —
// otherwise a dense run of near-duplicates (each only 1-2 min apart from the
// next) can chain together into one giant group spanning a much wider gap
// than the threshold actually allows. Routes with no drive time (failed
// scrapes) are dropped, since they can't be meaningfully compared.
function dedupeSimilar(scoredRoutes, { minuteThreshold = 2, dollarThreshold = 1 } = {}) {
  const valid = scoredRoutes.filter(r => r.driveTimeMinutes !== null);
  const byPreference = [...valid].sort((a, b) => b.preference - a.preference);

  const kept = [];
  for (const candidate of byPreference) {
    const dominated = kept.some(k =>
      Math.abs(k.driveTimeMinutes - candidate.driveTimeMinutes) <= minuteThreshold &&
      Math.abs(k.tollCost - candidate.tollCost) <= dollarThreshold
    );
    if (!dominated) kept.push(candidate);
  }

  return kept.sort((a, b) => a.score - b.score);
}

module.exports = { scoreRoutes, dedupeSimilar };
