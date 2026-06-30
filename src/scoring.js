const { calculateTolls, tollBreakdown } = require('./tolls');

// Scores and ranks all scraped route permutations.
// cost_score = toll_cost + (drive_time_hours * hourlyRate)
// Routes where scraping failed (driveTimeMinutes === null) are placed last.
function rankRoutes(permutations, hourlyRate) {
  const scored = permutations.map(perm => {
    const tollCost = calculateTolls(perm.tollSegmentIds);
    const driveTimeHours = perm.driveTimeMinutes !== null ? perm.driveTimeMinutes / 60 : null;
    const timeCost = driveTimeHours !== null ? driveTimeHours * hourlyRate : null;
    const score = (timeCost !== null) ? parseFloat((tollCost + timeCost).toFixed(2)) : null;

    return {
      ...perm,
      tollCost,
      tollBreakdown: tollBreakdown(perm.tollSegmentIds),
      timeCost,
      score
    };
  });

  // Sort: valid scores ascending, then null-score routes last
  scored.sort((a, b) => {
    if (a.score === null && b.score === null) return 0;
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return a.score - b.score;
  });

  // Add rank and plain-language explanation relative to the best route
  const best = scored.find(r => r.score !== null);
  return scored.map((route, i) => ({
    ...route,
    rank: i + 1,
    explanation: buildExplanation(route, best, hourlyRate)
  }));
}

function buildExplanation(route, best, hourlyRate) {
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

module.exports = { rankRoutes };
