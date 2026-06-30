const routes = require('../data/routes.json');

// Returns all non-empty subsets of an array.
function subsets(arr) {
  const result = [[]];
  for (const item of arr) {
    const len = result.length;
    for (let i = 0; i < len; i++) {
      result.push([...result[i], item]);
    }
  }
  return result.slice(1); // drop the empty set
}

// Geographic filter: toHome excludes waypoints north of origin; toWork excludes south of origin.
function geoFilter(waypoints, originLat, direction) {
  return waypoints.filter(wp => {
    if (direction === 'toHome') return wp.lat <= originLat;
    if (direction === 'toWork') return wp.lat >= originLat;
    return true;
  });
}

// Build every route permutation for a given direction and origin.
// Returns an array of route objects ready for scraping and scoring.
function buildPermutations(direction, origin) {
  const corridors = routes.corridors[direction];
  if (!corridors) throw new Error(`Unknown direction: ${direction}`);

  const crawfords = routes.sharedWaypoints.holmdel_crawfords;
  const permutations = [];

  for (const corridor of corridors) {
    // Filter corridor waypoints by geography
    const eligible = geoFilter(corridor.waypoints, origin.lat, direction);

    // Direct corridors (no waypoints defined) get one empty subset.
    // Non-direct corridors only generate subsets that include at least one waypoint —
    // an empty subset would duplicate the direct route with wrong toll assumptions.
    const isDirect = corridor.waypoints.length === 0;
    const wpSubsets = isDirect ? [[]] : subsets(eligible);

    // holmdel_crawfords applies to all corridors except those flagged skipCrawfords
    // (e.g. I-280, which never uses the GSP near home)
    const crawfordsApply = !corridor.skipCrawfords &&
      geoFilter([crawfords], origin.lat, direction).length > 0;

    const required = new Set(corridor.requiredWaypoints || []);

    for (const wpSubset of wpSubsets) {
      // Skip subsets that are missing a required waypoint
      if (required.size > 0 && !([...required].every(id => wpSubset.some(w => w.id === id)))) continue;
      // Generate with and without holmdel_crawfords where applicable
      const variants = crawfordsApply ? [false, true] : [false];

      for (const useCrawfords of variants) {
        // Build ordered waypoint list: sort N→S (decreasing lat) for toHome, S→N for toWork
        const wpList = [...wpSubset];
        if (useCrawfords) wpList.push(crawfords);

        wpList.sort((a, b) =>
          direction === 'toHome' ? b.lat - a.lat : a.lat - b.lat
        );

        // Collect all toll segments (deduplicated)
        const tollSegmentIds = new Set([...corridor.tollSegments]);
        for (const wp of wpList) {
          for (const seg of (wp.tollSegments || [])) tollSegmentIds.add(seg);
        }

        // GSP corridors: if holmdel_crawfords not used, add the Exit 117 ramp toll ($0.79).
        // Skip for corridors that don't use the GSP near home (skipCrawfords flag).
        if (!corridor.skipCrawfords && !useCrawfords) tollSegmentIds.add('gsp_holmdel_ramp');

        const label = buildLabel(corridor.name, wpSubset, useCrawfords);

        permutations.push({
          corridorId: corridor.id,
          corridorName: corridor.name,
          label,
          waypoints: wpList,
          tollSegmentIds: [...tollSegmentIds],
          usesCrawfords: useCrawfords
        });
      }
    }
  }

  const count = permutations.length;
  if (count > 20) {
    console.warn(`[permutations] WARNING: ${count} permutations generated — consider narrowing waypoints`);
  } else {
    console.log(`[permutations] ${count} permutations`);
  }

  return permutations;
}

function buildLabel(corridorName, wpSubset, useCrawfords) {
  const parts = [corridorName];
  if (wpSubset.length) parts.push(`via ${wpSubset.map(w => w.name).join(' → ')}`);
  if (useCrawfords) parts.push('+ Exit 116');
  return parts.join(' ');
}

module.exports = { buildPermutations };
