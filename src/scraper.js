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

// Builds a Google Maps directions URL with ordered waypoints.
function buildMapsUrl(origin, destination, waypoints) {
  const encode = (s) => encodeURIComponent(typeof s === 'string' ? s : `${s.lat},${s.lng}`);
  const base = 'https://www.google.com/maps/dir/';
  const parts = [encode(origin.address || `${origin.lat},${origin.lng}`)];
  for (const wp of waypoints) parts.push(encode(wp.address || `${wp.lat},${wp.lng}`));
  parts.push(encode(destination.address || `${destination.lat},${destination.lng}`));
  return base + parts.join('/') + '/';
}

// Scrapes drive time from a single Google Maps URL.
// Returns minutes as a number, or null if extraction fails.
async function scrapeOneRoute(page, url, label) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    // Give the route panel time to render
    await new Promise(r => setTimeout(r, 2000));

    for (const selector of TIME_SELECTORS) {
      try {
        const el = await page.$(selector);
        if (!el) continue;
        const text = await page.evaluate(e => e.textContent || e.getAttribute('aria-label') || '', el);
        const minutes = parseTimeText(text);
        if (minutes !== null) {
          console.log(`  [scraper] "${label}" → ${minutes} min (selector: ${selector})`);
          return minutes;
        }
      } catch {
        // try next selector
      }
    }

    // All selectors failed — log the URL for debugging
    console.warn(`  [scraper] WARN: no time found for "${label}" — URL: ${url}`);
    console.warn(`  [scraper] To debug, set puppeteerHeadless: false in config.json and inspect the page`);
    return null;
  } catch (err) {
    console.error(`  [scraper] ERROR on "${label}": ${err.message}`);
    return null;
  }
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

// Scrapes drive times for all permutations.
// Returns the permutations array enriched with { mapsUrl, driveTimeMinutes }.
async function scrapeTimes(permutations, origin, destination) {
  const headless = config.puppeteerHeadless !== false; // default true; set false to watch
  const browser = await puppeteer.launch({
    headless: headless ? 'new' : false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', // required on Linux containers (small /dev/shm)
      '--disable-gpu',
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const results = [];

  for (const perm of permutations) {
    const url = buildMapsUrl(origin, destination, perm.waypoints);
    const driveTimeMinutes = await scrapeOneRoute(page, url, perm.label);
    results.push({ ...perm, mapsUrl: url, driveTimeMinutes });
  }

  await browser.close();

  const failed = results.filter(r => r.driveTimeMinutes === null).length;
  if (failed > 0) {
    console.warn(`[scraper] ${failed}/${results.length} routes failed time extraction`);
  }

  return results;
}

module.exports = { scrapeTimes, buildMapsUrl, parseTimeText };
