const rates = require('../data/ezpass-rates.json');

// Returns the total EZ-Pass toll cost for a route given its list of segment IDs.
// Segments with null ezpassCost (placeholders) are skipped with a warning.
function calculateTolls(tollSegmentIds) {
  let total = 0;
  for (const id of tollSegmentIds) {
    const seg = rates.segments[id];
    if (!seg) {
      console.warn(`[tolls] Unknown segment ID: "${id}" — skipping`);
      continue;
    }
    if (seg.ezpassCost === null) {
      console.warn(`[tolls] Segment "${id}" (${seg.name}) has no cost yet — fill in ezpass-rates.json`);
      continue;
    }
    total += seg.ezpassCost;
  }
  return parseFloat(total.toFixed(2));
}

// Returns a human-readable breakdown of toll segments for display.
function tollBreakdown(tollSegmentIds) {
  return tollSegmentIds.map(id => {
    const seg = rates.segments[id];
    if (!seg) return { id, name: id, cost: null, warning: 'unknown segment' };
    return {
      id,
      name: seg.name,
      road: seg.road,
      cost: seg.ezpassCost,
      placeholder: seg.ezpassCost === null
    };
  });
}

module.exports = { calculateTolls, tollBreakdown };
