// Standalone Puppeteer scraper test — runs one hardcoded route and logs everything.
// Usage:  node test-scraper.js
// Set HEADLESS=false to watch the browser:  HEADLESS=false node test-scraper.js

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { parseTimeText } = require('./src/scraper');

// Direct Work→Home route, no waypoints (the natural 16W Turnpike route)
const TEST_URL =
  'https://www.google.com/maps/dir/77+River+Rd,+Clifton,+NJ+07014/45+Stonehenge+Dr,+Lincroft,+NJ+07738/';

// Ordered list of selectors to attempt — same list used in production scraper
const SELECTORS = [
  // Accessible duration spans/divs Google Maps renders in the route card
  '[data-value][aria-label*="min"]',
  '[aria-label*=" min"]',
  '[aria-label*="hour"]',
  // Common class names observed in Google Maps DOM (may change with deployments)
  '.Fk3sm',
  '.UzeeY',
  '.XdKEzd',
  '.tUEI8e',
  // Broader fallbacks
  'div[class*="duration"]',
  'span[class*="duration"]',
  'div[jstcache] span[aria-label]',
];

// Time-text patterns to find by scanning all visible text in the page
const TIME_PATTERN = /\b(\d+\s*h(r|our)?s?\s*)?\d+\s*min\b/i;

async function run() {
  const headless = process.env.HEADLESS !== 'false';
  console.log(`\nLaunching Puppeteer (headless: ${headless})`);
  console.log(`URL: ${TEST_URL}\n`);

  const browser = await puppeteer.launch({
    headless: headless ? 'new' : false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  // Suppress console noise from Google Maps JS
  page.on('console', () => {});

  console.log('Navigating...');
  await page.goto(TEST_URL, { waitUntil: 'networkidle2', timeout: 45000 });

  console.log('Page loaded. Waiting 3s for route panel to render...');
  await new Promise(r => setTimeout(r, 3000));

  // --- Selector probe ---
  console.log('\n=== SELECTOR PROBE ===');
  for (const sel of SELECTORS) {
    try {
      const els = await page.$$(sel);
      if (els.length === 0) {
        console.log(`  ${sel.padEnd(45)} → 0 matches`);
        continue;
      }
      const texts = await Promise.all(
        els.slice(0, 3).map(el =>
          page.evaluate(e => {
            return (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 60);
          }, el)
        )
      );
      console.log(`  ${sel.padEnd(45)} → ${els.length} match(es): ${texts.map(t => JSON.stringify(t)).join(', ')}`);
    } catch (err) {
      console.log(`  ${sel.padEnd(45)} → ERROR: ${err.message}`);
    }
  }

  // --- Full-page time text scan ---
  console.log('\n=== TIME TEXT SCAN (all visible text matching time pattern) ===');
  const allText = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const results = [];
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent.trim();
      if (t) results.push(t);
    }
    return results;
  });

  const timeMatches = allText.filter(t => TIME_PATTERN.test(t));
  if (timeMatches.length === 0) {
    console.log('  No time strings found in page text.');
  } else {
    timeMatches.slice(0, 10).forEach(t => console.log(`  "${t}"`));
  }

  // --- aria-label scan ---
  console.log('\n=== ARIA-LABEL SCAN (all elements with aria-label containing time) ===');
  const ariaMatches = await page.evaluate((pattern) => {
    const all = document.querySelectorAll('[aria-label]');
    const results = [];
    for (const el of all) {
      const label = el.getAttribute('aria-label') || '';
      if (/\bmin\b|\bhour\b|\bhr\b/i.test(label)) {
        results.push({
          tag: el.tagName,
          className: el.className.slice(0, 60),
          ariaLabel: label.slice(0, 80)
        });
      }
    }
    return results.slice(0, 10);
  }, null);

  if (ariaMatches.length === 0) {
    console.log('  No aria-label time matches found.');
  } else {
    ariaMatches.forEach(m =>
      console.log(`  <${m.tag} class="${m.className}"> aria-label="${m.ariaLabel}"`)
    );
  }

  // --- Parse attempt ---
  console.log('\n=== PARSE ATTEMPT ===');
  let found = null;
  for (const sel of SELECTORS) {
    try {
      const el = await page.$(sel);
      if (!el) continue;
      const text = await page.evaluate(
        e => (e.textContent || e.getAttribute('aria-label') || '').trim(), el
      );
      const mins = parseTimeText(text);
      if (mins !== null) {
        console.log(`  SUCCESS with selector: ${sel}`);
        console.log(`  Raw text: "${text}"`);
        console.log(`  Parsed:   ${mins} minutes`);
        found = mins;
        break;
      }
    } catch { /* try next */ }
  }
  if (found === null) {
    console.log('  No selector produced a parseable time.');
    console.log('  → Check the aria-label and text scan output above to identify the right selector.');
    console.log('  → Run with HEADLESS=false to inspect the page manually.');
  }

  // --- Screenshot ---
  const screenshotPath = path.join(__dirname, 'scraper-test.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`\nScreenshot saved: ${screenshotPath}`);

  await browser.close();
  console.log('\nDone.');
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
