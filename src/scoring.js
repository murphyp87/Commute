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

  const best = scored.find(r => r.score !== null);
  return scored.map((route, i) => ({
    ...route,
    rank: i + 1,
    explanation: buildExplanation(route, best)
  }));
}

function buildExplanation(route, best) {
  if (route.driveTimeMinutes === null) {
    return 'Drive time could not be retrieved — check scraper logs for selector failures.';
  }
  if (route === best) {
    return `Best overall at $${route.score.toFixed(2)} combined score ($${route.tollCost.toFixed(2)} tolls + ${route.driveTimeMinutes} min drive valued at $${route.timeCost.toFixed(2)}).`;
  }

  const parts = [];
  const timeDiff = route.driveTimeMinutes - best.driveTimeMinutes;
  const tollDiff = route.tollCost - best.tollCost;
  const scoreDiff = route.score - best.score;

  parts.push(`$${scoreDiff.toFixed(2)} more than the top route.`);
  if (tollDiff > 0) parts.push(`Costs $${tollDiff.toFixed(2)} more in tolls.`);
  else if (tollDiff < 0) parts.push(`Saves $${Math.abs(tollDiff).toFixed(2)} in tolls.`);
  if (timeDiff > 0) parts.push(`Takes ${timeDiff} min longer.`);
  else if (timeDiff < 0) parts.push(`Saves ${Math.abs(timeDiff)} min.`);

  return parts.join(' ');
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
