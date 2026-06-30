// End-to-end test: runs all permutations for one direction, ranks results, prints table.
// Usage:
//   node test-e2e.js toHome
//   node test-e2e.js toWork
//   node test-e2e.js toHome 30        (hourly rate override)
//   HEADLESS=false node test-e2e.js toHome   (watch the browser)

const { buildPermutations } = require('./src/permutations');
const { scrapeTimes } = require('./src/scraper');
const { rankRoutes } = require('./src/scoring');
const config = require('./config.json');

const direction = process.argv[2] || 'toHome';
const hourlyRate = parseFloat(process.argv[3]) || config.defaultHourlyRate;

if (!['toHome', 'toWork'].includes(direction)) {
  console.error('Usage: node test-e2e.js toHome|toWork [hourlyRate]');
  process.exit(1);
}

const origin = direction === 'toHome' ? config.locations.work : config.locations.home;
const destination = direction === 'toHome' ? config.locations.home : config.locations.work;

async function run() {
  console.log('='.repeat(60));
  console.log(`NJ Commute Optimizer — End-to-End Test`);
  console.log(`Direction : ${direction}`);
  console.log(`From      : ${origin.address}`);
  console.log(`To        : ${destination.address}`);
  console.log(`Rate      : $${hourlyRate}/hr`);
  console.log('='.repeat(60));

  // Step 1: build permutations
  const perms = buildPermutations(direction, origin);
  console.log(`\nPermutations (${perms.length}):`);
  perms.forEach((p, i) =>
    console.log(`  ${String(i + 1).padStart(2)}. [${p.corridorId}] ${p.label}`)
  );

  // Step 2: scrape (this takes a while — one Maps page per route)
  console.log(`\nScraping ${perms.length} routes — estimated ${Math.ceil(perms.length * 8 / 60)} min...`);
  const start = Date.now();
  const timed = await scrapeTimes(perms, origin, destination);
  const elapsed = ((Date.now() - start) / 1000).toFixed(0);
  console.log(`\nScraping complete in ${elapsed}s`);

  // Step 3: score and rank
  const ranked = rankRoutes(timed, hourlyRate);

  // Step 4: print results table
  console.log('\n' + '='.repeat(60));
  console.log('RESULTS (ranked by combined score)');
  console.log('='.repeat(60));

  const failed = ranked.filter(r => r.driveTimeMinutes === null);
  const valid  = ranked.filter(r => r.driveTimeMinutes !== null);

  valid.forEach(r => {
    const time  = r.driveTimeMinutes < 60
      ? `${r.driveTimeMinutes}m`
      : `${Math.floor(r.driveTimeMinutes/60)}h${r.driveTimeMinutes%60}m`;
    const toll  = `$${r.tollCost.toFixed(2)}`;
    const score = `$${r.score.toFixed(2)}`;
    console.log(
      `#${String(r.rank).padEnd(2)} | ${time.padEnd(7)} | tolls ${toll.padEnd(6)} | score ${score.padEnd(7)} | ${r.label}`
    );
    console.log(`     → ${r.explanation}`);
  });

  if (failed.length > 0) {
    console.log(`\nFailed to scrape (${failed.length}):`);
    failed.forEach(r => console.log(`  - ${r.label}`));
  }

  console.log('\nDone.');
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
