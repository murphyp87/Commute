const express = require('express');
const path = require('path');
const config = require('./config.json');
const { getApplicableRoutes, isPeakNow, extractWaypoints } = require('./src/routesData');
const { scrapeRoutes, buildMapsUrl, buildWaypointMapsUrl } = require('./src/scraper');
const { scoreRoutes, dedupeSimilar } = require('./src/scoring');

const app = express();
const PORT = process.env.PORT || 3000;

// Only throw out a route's waypoint if it's more than this far in the wrong
// direction — a strict north/south cutoff was too eager to drop otherwise-
// valid waypoints sitting close to the live position.
const WAYPOINT_MARGIN_MILES = 2;
const MILES_PER_DEGREE_LATITUDE = 69; // ~constant regardless of longitude
const WAYPOINT_MARGIN_DEGREES = WAYPOINT_MARGIN_MILES / MILES_PER_DEGREE_LATITUDE;

// Fixed GSP mainline toll-plaza/exit locations used to decide which mainline
// tolls a live-location trip would actually still cross. Coordinates found
// via web search (Essex/Raritan plazas); Exit 114 taken from routes.csv's
// own "114-*" route waypoints.
const GSP_EXIT_114 = { lat: 40.3754147, lng: -74.1456679 };
const GSP_ESSEX_TOLL_PLAZA = { lat: 40.805132, lng: -74.184360 }; // Bloomfield, between exits 149-150
const GSP_RARITAN_TOLL_PLAZA = { lat: 40.486644, lng: -74.302905 }; // Sayreville

// Named ToWork routes charge Toll1 only when entering the GSP at/below
// Exit 114 (116-entry routes already carry Toll1=$0) — so if the live
// origin is already north of Exit 114, that toll no longer applies. Named
// ToHome routes' Toll1/Toll2 represent the Essex/Raritan mainline barriers
// respectively — if the live origin is already south of one, that barrier
// was never crossed.
function adjustTollForLiveOrigin(direction, liveOrigin, route) {
  if (direction === 'ToWork') {
    return liveOrigin.lat > GSP_EXIT_114.lat ? route.tollTotal - route.toll1 : route.tollTotal;
  }
  let adjusted = route.tollTotal;
  if (liveOrigin.lat < GSP_ESSEX_TOLL_PLAZA.lat) adjusted -= route.toll1;
  if (liveOrigin.lat < GSP_RARITAN_TOLL_PLAZA.lat) adjusted -= route.toll2;
  return adjusted;
}

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
  const { direction: dirParam, hourlyRate, similarityMinutes, similarityDollars, origin: liveOrigin } = req.body;

  const direction = dirParam === 'toHome' ? 'ToHome' : dirParam === 'toWork' ? 'ToWork' : null;
  if (!direction) {
    return res.status(400).json({ error: 'direction must be toHome or toWork' });
  }

  const rate = parseFloat(hourlyRate) || config.defaultHourlyRate;
  const minuteThreshold = parseFloat(similarityMinutes) || config.similarityMinutes;
  const dollarThreshold = parseFloat(similarityDollars) || config.similarityDollars;

  const fixedOrigin = direction === 'ToHome' ? config.locations.work : config.locations.home;
  const destination = direction === 'ToHome' ? config.locations.home : config.locations.work;

  const usingLiveOrigin = liveOrigin && typeof liveOrigin.lat === 'number' && typeof liveOrigin.lng === 'number';
  const scrapeOrigin = usingLiveOrigin ? liveOrigin : fixedOrigin;

  const peakNow = isPeakNow();
  // Every named route's own waypoints are always extracted from its CSV
  // GoogleMapsLink — the raw link itself is only ever used as a source of
  // waypoint coordinates now, never opened directly (see buildWaypointMapsUrl
  // note below).
  let applicable = getApplicableRoutes(direction, peakNow)
    .map(r => ({ ...r, waypoints: extractWaypoints(r.mapsUrl) }));

  // With a live origin, a waypoint already behind us no longer needs to be
  // forced — drop just that waypoint (not the whole route), keeping
  // whichever remain ahead, since those are what still distinguish one
  // named route from another (e.g. which GSP exit to take near the
  // destination). A route left with zero waypoints is a plain point-to-
  // point trip — identical to Google Default — so it's dropped instead of
  // scraped again; routes that reduce to the exact same remaining
  // waypoints are also deduped, keeping the higher-preference one.
  if (usingLiveOrigin) {
    applicable = applicable
      .map(r => ({
        ...r,
        waypoints: r.waypoints.filter(w =>
          direction === 'ToHome'
            ? w.lat <= liveOrigin.lat + WAYPOINT_MARGIN_DEGREES
            : w.lat >= liveOrigin.lat - WAYPOINT_MARGIN_DEGREES
        )
      }))
      .filter(r => r.waypoints.length > 0);

    const seenKeys = new Set();
    applicable = applicable.filter(r => {
      const key = r.waypoints.map(w => `${w.lat},${w.lng}`).join('|');
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });
  }

  if (applicable.length === 0) {
    return res.status(500).json({ error: `No routes defined for ${direction} in routes.csv` });
  }

  const maxTollFallback = Math.max(...applicable.map(r => r.tollTotal));

  // buildWaypointMapsUrl's plain coordinate-path form (not the CSV link's raw
  // `data=` blob) is used for every named route, live origin or not — on an
  // iPhone, tapping a google.com/maps link hands off to the native Maps app,
  // which understands plain origin/waypoint/destination stops but silently
  // drops the desktop web UI's internal `data=` waypoint blob and falls back
  // to its own default route. This was reported as "cards all open the
  // Google Default route" even though the server-side scrape (a desktop
  // Chrome, which does honor the data= blob) was already scoring/ranking
  // correctly — a display-only bug on mobile, not a scoring bug.
  const scrapeList = [
    ...applicable.map(r => ({
      name: r.name,
      mapsUrl: buildWaypointMapsUrl(scrapeOrigin, r.waypoints, destination)
    })),
    { name: 'Google Default', mapsUrl: buildMapsUrl(scrapeOrigin, destination), checkTollHint: true }
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
      mapsUrl: s.mapsUrl,
      tollCost: usingLiveOrigin ? adjustTollForLiveOrigin(direction, liveOrigin, meta) : meta.tollTotal,
      tollEstimated: usingLiveOrigin,
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
    origin: usingLiveOrigin ? 'your current location' : fixedOrigin.address,
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
