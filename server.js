const express = require('express');
const path = require('path');
const config = require('./config.json');
const { getApplicableRoutes, isPeakNow } = require('./src/routesData');
const { scrapeRoutes, buildMapsUrl } = require('./src/scraper');
const { scoreRoutes, dedupeSimilar } = require('./src/scoring');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/config', (req, res) => {
  res.json({
    defaultHourlyRate: config.defaultHourlyRate,
    similarityMinutes: config.similarityMinutes,
    similarityDollars: config.similarityDollars,
    topResultsCount: config.topResultsCount,
    work: config.locations.work,
    home: config.locations.home
  });
});

// POST /optimize
// Body: { direction: 'toHome'|'toWork', hourlyRate?, similarityMinutes?, similarityDollars? }
app.post('/optimize', async (req, res) => {
  const { direction: dirParam, hourlyRate, similarityMinutes, similarityDollars } = req.body;

  const direction = dirParam === 'toHome' ? 'ToHome' : dirParam === 'toWork' ? 'ToWork' : null;
  if (!direction) {
    return res.status(400).json({ error: 'direction must be toHome or toWork' });
  }

  const rate = parseFloat(hourlyRate) || config.defaultHourlyRate;
  const minuteThreshold = parseFloat(similarityMinutes) || config.similarityMinutes;
  const dollarThreshold = parseFloat(similarityDollars) || config.similarityDollars;

  const origin = direction === 'ToHome' ? config.locations.work : config.locations.home;
  const destination = direction === 'ToHome' ? config.locations.home : config.locations.work;

  const peakNow = isPeakNow();
  const applicable = getApplicableRoutes(direction, peakNow);

  if (applicable.length === 0) {
    return res.status(500).json({ error: `No routes defined for ${direction} in routes.csv` });
  }

  const maxTollFallback = Math.max(...applicable.map(r => r.tollTotal));

  const scrapeList = [
    ...applicable.map(r => ({ name: r.name, mapsUrl: r.mapsUrl })),
    { name: 'Google Default', mapsUrl: buildMapsUrl(origin, destination), checkTollHint: true }
  ];

  console.log(`\n[optimize] direction=${direction} peak=${peakNow} rate=$${rate}/hr routes=${scrapeList.length}`);

  let scraped;
  try {
    scraped = await scrapeRoutes(scrapeList);
  } catch (err) {
    console.error('[optimize] scraper error:', err.message);
    return res.status(500).json({ error: 'Failed to scrape drive times', detail: err.message });
  }

  const byName = new Map(applicable.map(r => [r.name, r]));

  const routesForScoring = scraped.map(s => {
    if (s.name === 'Google Default') {
      const tollEstimated = s.tollHint === true;
      return {
        name: 'Google Default',
        preference: 0,
        mapsUrl: s.mapsUrl,
        tollCost: tollEstimated ? maxTollFallback : 0,
        tollEstimated,
        driveTimeMinutes: s.driveTimeMinutes
      };
    }
    const meta = byName.get(s.name);
    return {
      name: s.name,
      preference: meta.preference,
      mapsUrl: meta.mapsUrl,
      tollCost: meta.tollTotal,
      tollEstimated: false,
      driveTimeMinutes: s.driveTimeMinutes
    };
  });

  const fullList = scoreRoutes(routesForScoring, rate);
  let top3 = dedupeSimilar(fullList, { minuteThreshold, dollarThreshold }).slice(0, config.topResultsCount);

  // Google Default always gets a card slot — as a 4th, visually secondary card —
  // unless it already won a spot on its own merit.
  const defaultRoute = fullList.find(r => r.name === 'Google Default');
  const defaultInTop3 = top3.some(r => r.name === 'Google Default');
  let googleDefaultCard = (!defaultInTop3 && defaultRoute && defaultRoute.driveTimeMinutes !== null)
    ? defaultRoute
    : null;

  // Re-rank/re-explain relative to what's actually on screen — otherwise a card
  // shown as "#1" could confusingly say "$X more than the top route" because a
  // cheaper-but-too-similar route was suppressed from fullList's real #1 spot.
  const displaySet = googleDefaultCard ? [...top3, googleDefaultCard] : top3;
  const redisplayed = scoreRoutes(displaySet, rate);
  top3 = redisplayed.filter(r => r.name !== 'Google Default' || defaultInTop3);
  if (googleDefaultCard) googleDefaultCard = redisplayed.find(r => r.name === 'Google Default');

  res.json({
    direction: dirParam,
    origin: origin.address,
    destination: destination.address,
    hourlyRate: rate,
    isPeak: peakNow,
    top3,
    googleDefaultCard,
    fullList
  });
});

app.listen(PORT, () => {
  console.log(`Commute optimizer running at http://localhost:${PORT}`);
  console.log(`Puppeteer headless: ${config.puppeteerHeadless}`);
});
