// End-to-end test: runs the CSV-driven route list for one direction, ranks
// results, prints table.
// Usage:
//   node test-e2e.js toHome
//   node test-e2e.js toWork
//   node test-e2e.js toHome 30        (hourly rate override)
//   HEADLESS=false node test-e2e.js toHome   (watch the browser)

const { getApplicableRoutes, isPeakNow } = require('./src/routesData');
const { scrapeRoutes, buildMapsUrl } = require('./src/scraper');
const { scoreRoutes, dedupeSimilar } = require('./src/scoring');
const config = require('./config.json');

const dirParam = process.argv[2] || 'toHome';
const hourlyRate = parseFloat(process.argv[3]) || config.defaultHourlyRate;

if (!['toHome', 'toWork'].includes(dirParam)) {
  console.error('Usage: node test-e2e.js toHome|toWork [hourlyRate]');
  process.exit(1);
}

const direction = dirParam === 'toHome' ? 'ToHome' : 'ToWork';
const origin = direction === 'ToHome' ? config.locations.work : config.locations.home;
const destination = direction === 'ToHome' ? config.locations.home : config.locations.work;

async function run() {
  const peakNow = isPeakNow();

  console.log('='.repeat(60));
  console.log(`NJ Commute Optimizer — End-to-End Test`);
  console.log(`Direction : ${direction}`);
  console.log(`From      : ${origin.address}`);
  console.log(`To        : ${destination.address}`);
  console.log(`Rate      : $${hourlyRate}/hr`);
  console.log(`Peak now  : ${peakNow}`);
  console.log('='.repeat(60));

  const applicable = getApplicableRoutes(direction, peakNow);
  const maxTollFallback = Math.max(...applicable.map(r => r.tollTotal));

  console.log(`\nRoutes (${applicable.length} + Google Default):`);
  applicable.forEach((r, i) =>
    console.log(`  ${String(i + 1).padStart(2)}. ${r.name} (pref ${r.preference}, toll $${r.tollTotal.toFixed(2)})`)
  );

  const scrapeList = [
    ...applicable.map(r => ({ name: r.name, mapsUrl: r.mapsUrl })),
    { name: 'Google Default', mapsUrl: buildMapsUrl(origin, destination), checkTollHint: true }
  ];

  console.log(`\nScraping ${scrapeList.length} routes in parallel...`);
  const start = Date.now();
  const scraped = await scrapeRoutes(scrapeList);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Scraping complete in ${elapsed}s`);

  const byName = new Map(applicable.map(r => [r.name, r]));
  const routesForScoring = scraped.map(s => {
    if (s.name === 'Google Default') {
      const tollEstimated = s.tollHint === true;
      return {
        name: 'Google Default', preference: 0, mapsUrl: s.mapsUrl,
        tollCost: tollEstimated ? maxTollFallback : 0, tollEstimated,
        driveTimeMinutes: s.driveTimeMinutes
      };
    }
    const meta = byName.get(s.name);
    return {
      name: s.name, preference: meta.preference, mapsUrl: meta.mapsUrl,
      tollCost: meta.tollTotal, tollEstimated: false,
      driveTimeMinutes: s.driveTimeMinutes
    };
  });

  const fullList = scoreRoutes(routesForScoring, hourlyRate);
  const top3 = dedupeSimilar(fullList, {
    minuteThreshold: config.similarityMinutes,
    dollarThreshold: config.similarityDollars
  }).slice(0, config.topResultsCount);

  console.log('\n' + '='.repeat(60));
  console.log('FULL LIST (ranked by combined score)');
  console.log('='.repeat(60));

  fullList.forEach(r => {
    if (r.driveTimeMinutes === null) {
      console.log(`  FAILED | ${r.name}`);
      return;
    }
    const time = `${r.driveTimeMinutes}m`;
    const toll = `$${r.tollCost.toFixed(2)}${r.tollEstimated ? ' (est)' : ''}`;
    const score = `$${r.score.toFixed(2)}`;
    console.log(`#${String(r.rank).padEnd(2)} | ${time.padEnd(5)} | tolls ${toll.padEnd(12)} | score ${score.padEnd(7)} | ${r.name}`);
    console.log(`     → ${r.explanation}`);
  });

  console.log('\n' + '='.repeat(60));
  console.log(`TOP ${config.topResultsCount} CARDS`);
  console.log('='.repeat(60));
  top3.forEach((r, i) => console.log(`#${i + 1} ${r.name} — ${r.driveTimeMinutes}m, $${r.tollCost.toFixed(2)}, score $${r.score.toFixed(2)}`));

  const defaultInTop3 = top3.some(r => r.name === 'Google Default');
  if (!defaultInTop3) {
    const def = fullList.find(r => r.name === 'Google Default');
    console.log(`(4th, Google Default) ${def.name} — ${def.driveTimeMinutes}m, $${def.tollCost.toFixed(2)}${def.tollEstimated ? ' (est)' : ''}, score $${def.score.toFixed(2)}`);
  }

  console.log('\nDone.');
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
