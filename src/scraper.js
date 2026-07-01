// NOTE: This module scrapes live Google Maps direction pages using Puppeteer.
// Automated scraping of Google Maps may violate Google's Terms of Service.
// This is a personal tool used at very low frequency — not a production service.

const puppeteer = require('puppeteer');
const config = require('../config.json');

// CSS selectors to try, in order, when extracting drive time from the Maps DOM.
// Google changes these periodically — update here if scraping breaks.
const TIME_SELECTORS = [
  '.Fk3sm',                                 // confirmed working (tested 2026-06)
  '.XdKEzd',                                // contains "54 min48.4 miles" — needs text split
  '.UzeeY',                                 // alternate duration class
  '[data-value][aria-label*="min"]',        // aria-labeled duration chips
  '[aria-label*=" min"]',
  'div[class*="duration"]',
];

// Builds a plain (no forced waypoints) Google Maps directions URL — used for the
// always-included "Google Default" route.
function buildMapsUrl(origin, destination) {
  const encode = (s) => encodeURIComponent(typeof s === 'string' ? s : `${s.lat},${s.lng}`);
  return `https://www.google.com/maps/dir/${encode(origin.address || `${origin.lat},${origin.lng}`)}/${encode(destination.address || `${destination.lat},${destination.lng}`)}/`;
}

// Parses a Google Maps time string like "1 hr 23 min" or "45 min" into total minutes.
function parseTimeText(text) {
  if (!text) return null;
  const hrMatch = text.match(/(\d+)\s*h/i);
  const minMatch = text.match(/(\d+)\s*m/i);
  const hours = hrMatch ? parseInt(hrMatch[1], 10) : 0;
  const mins = minMatch ? parseInt(minMatch[1], 10) : 0;
  if (hours === 0 && mins === 0) return null;
  return hours * 60 + mins;
}

// Google's directions panel doesn't show an exact toll dollar amount for the
// top route, but it does flag "This route has tolls." when tolls apply.
async function pageHasTollHint(page) {
  try {
    const bodyText = await page.evaluate(() => document.body.innerText);
    return /this route has tolls/i.test(bodyText);
  } catch {
    return false;
  }
}

// Scrapes drive time (and optionally a toll hint) from a single Google Maps URL.
async function scrapeOneRoute(page, url, label, { checkTollHint = false } = {}) {
  try {
    // Google Maps keeps background network traffic (tiles, telemetry) going
    // indefinitely, so 'networkidle2' routinely burns its full timeout waiting
    // for quiet that never comes. 'domcontentloaded' plus the explicit
    // waitForSelector below (which is the actual readiness signal we care
    // about) is both faster and lighter on constrained hosts.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });

    // Fast path: wait directly for the known-good selector instead of a blind sleep.
    try {
      await page.waitForSelector(TIME_SELECTORS[0], { timeout: 6000 });
    } catch {
      // Didn't show up in time — give the panel a bit longer, then try every selector below.
      await new Promise(r => setTimeout(r, 1000));
    }

    let driveTimeMinutes = null;
    for (const selector of TIME_SELECTORS) {
      try {
        const el = await page.$(selector);
        if (!el) continue;
        const text = await page.evaluate(e => e.textContent || e.getAttribute('aria-label') || '', el);
        const minutes = parseTimeText(text);
        if (minutes !== null) {
          console.log(`  [scraper] "${label}" → ${minutes} min (selector: ${selector})`);
          driveTimeMinutes = minutes;
          break;
        }
      } catch {
        // try next selector
      }
    }

    if (driveTimeMinutes === null) {
      console.warn(`  [scraper] WARN: no time found for "${label}" — URL: ${url}`);
      console.warn(`  [scraper] To debug, set puppeteerHeadless: false in config.json and inspect the page`);
    }

    const tollHint = checkTollHint ? await pageHasTollHint(page) : null;
    return { driveTimeMinutes, tollHint };
  } catch (err) {
    console.error(`  [scraper] ERROR on "${label}": ${err.message}`);
    return { driveTimeMinutes: null, tollHint: null };
  }
}

// Scrapes drive times for a fixed list of routes: [{ name, mapsUrl, checkTollHint? }].
// Routes are scraped across a pool of concurrent tabs (scraperConcurrency in
// config.json, defaults to scraping all of them at once since the route list is
// now small and fixed) instead of one at a time.
async function scrapeRoutes(routes) {
  const headless = config.puppeteerHeadless !== false; // default true; set false to watch
  const concurrency = Math.max(1, Math.min(config.scraperConcurrency || routes.length, routes.length));
  const startedAt = Date.now();
  const browser = await puppeteer.launch({
    headless: headless ? 'new' : false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', // required on Linux containers (small /dev/shm)
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-first-run',
    ]
  });

  try {
    const results = new Array(routes.length);
    let nextIndex = 0;

    async function worker() {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      while (nextIndex < routes.length) {
        const i = nextIndex++;
        const route = routes[i];
        // Hard cap per route so one stuck page can't stall the whole batch —
        // scrapeOneRoute already catches its own errors, but a hung page
        // (e.g. a wedged Chrome renderer under memory pressure) can still
        // hang past its internal timeouts.
        const { driveTimeMinutes, tollHint } = await Promise.race([
          scrapeOneRoute(page, route.mapsUrl, route.name, route),
          new Promise(resolve => setTimeout(() => resolve({ driveTimeMinutes: null, tollHint: null }), 12000))
        ]);
        results[i] = { ...route, driveTimeMinutes, tollHint };
      }
      await page.close();
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    const failed = results.filter(r => r.driveTimeMinutes === null).length;
    console.log(`[scraper] finished ${results.length} routes in ${((Date.now() - startedAt) / 1000).toFixed(1)}s (concurrency=${concurrency})`);
    if (failed > 0) {
      console.warn(`[scraper] ${failed}/${results.length} routes failed time extraction`);
    }

    return results;
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { scrapeRoutes, buildMapsUrl, parseTimeText };
