const express = require('express');
const path = require('path');
const config = require('./config.json');
const { buildPermutations } = require('./src/permutations');
const { scrapeTimes } = require('./src/scraper');
const { calculateTolls } = require('./src/tolls');
const { rankRoutes } = require('./src/scoring');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/config', (req, res) => {
  res.json({
    defaultHourlyRate: config.defaultHourlyRate,
    work: config.locations.work,
    home: config.locations.home
  });
});

// POST /optimize
// Body: { direction: 'toHome'|'toWork', originLat?, originLng?, hourlyRate }
app.post('/optimize', async (req, res) => {
  const { direction, originLat, originLng, hourlyRate } = req.body;

  if (!['toHome', 'toWork'].includes(direction)) {
    return res.status(400).json({ error: 'direction must be toHome or toWork' });
  }

  const rate = parseFloat(hourlyRate) || config.defaultHourlyRate;

  // Override origin with geolocation if provided
  const origin = (originLat && originLng)
    ? { lat: parseFloat(originLat), lng: parseFloat(originLng), address: `${originLat},${originLng}` }
    : (direction === 'toHome' ? config.locations.work : config.locations.home);

  const destination = direction === 'toHome' ? config.locations.home : config.locations.work;

  console.log(`\n[optimize] direction=${direction} origin=${origin.address} rate=$${rate}/hr`);

  let permutations;
  try {
    permutations = buildPermutations(direction, origin);
    console.log(`[optimize] ${permutations.length} permutations generated`);
  } catch (err) {
    console.error('[optimize] permutation error:', err.message);
    return res.status(500).json({ error: 'Failed to build route permutations', detail: err.message });
  }

  let timed;
  try {
    timed = await scrapeTimes(permutations, origin, destination);
  } catch (err) {
    console.error('[optimize] scraper error:', err.message);
    return res.status(500).json({ error: 'Failed to scrape drive times', detail: err.message });
  }

  const scored = rankRoutes(timed, rate);

  res.json({
    direction,
    origin: origin.address,
    destination: destination.address,
    hourlyRate: rate,
    results: scored.slice(0, config.topResultsCount)
  });
});

app.listen(PORT, () => {
  console.log(`Commute optimizer running at http://localhost:${PORT}`);
  console.log(`Puppeteer headless: ${config.puppeteerHeadless}`);
});
