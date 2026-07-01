// Loads the master route list from data/routes.csv — the single source of truth
// for which routes exist, their toll costs, and their Google Maps links.
// Replaces the old permutations/corridor model entirely.

const fs = require('fs');
const path = require('path');

const CSV_PATH = path.join(__dirname, '../data/routes.csv');

// Minimal CSV parser: handles quoted fields with embedded commas (the
// GoogleMapsLink column contains commas inside its quotes).
function splitLine(line) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) { cells.push(cur); cur = ''; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = splitLine(lines[0]);
  return lines.slice(1).map(line => {
    const cells = splitLine(line);
    const row = {};
    header.forEach((key, i) => { row[key] = (cells[i] !== undefined ? cells[i] : '').trim(); });
    return row;
  });
}

// Parses a currency cell like " $2.25 " or " $-   " (meaning zero) into a number.
function parseCurrency(cell) {
  if (!cell || cell === '$-') return 0;
  const num = parseFloat(cell.replace(/[$,]/g, ''));
  return isNaN(num) ? 0 : num;
}

let cachedRows = null;
function loadRows() {
  if (!cachedRows) {
    const text = fs.readFileSync(CSV_PATH, 'utf8');
    cachedRows = parseCsv(text).map(r => ({
      direction: r.Direction,
      name: r.Name,
      offPeak: r['Off/Peak'], // '', 'Peak', or 'Off-Peak'
      preference: parseFloat(r.Preference),
      toll1: parseCurrency(r.Toll1),
      toll2: parseCurrency(r.Toll2),
      tollTotal: parseCurrency(r.TollTotal),
      mapsUrl: r.GoogleMapsLink
    }));
  }
  return cachedRows;
}

// Peak windows apply weekdays only: 6:45-9:00am and 4:10-6:30pm, NJ local time.
function isPeakNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23'
  }).formatToParts(date);
  const get = type => parts.find(p => p.type === type).value;

  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return false;

  const minutesSinceMidnight = parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10);
  const inWindow = (startH, startM, endH, endM) =>
    minutesSinceMidnight >= startH * 60 + startM && minutesSinceMidnight <= endH * 60 + endM;

  return inWindow(6, 45, 9, 0) || inWindow(16, 10, 18, 30);
}

// Returns one row per unique route Name for the given direction, keeping only
// the Peak or Off-Peak variant that currently applies. Rows with a blank
// Off/Peak column apply regardless of time and are always kept.
function getApplicableRoutes(direction, peakNow) {
  return loadRows()
    .filter(r => r.direction === direction)
    .filter(r => {
      if (!r.offPeak) return true;
      return peakNow ? r.offPeak === 'Peak' : r.offPeak === 'Off-Peak';
    });
}

// Pulls the ordered chain of coordinate pairs baked into a Google Maps dir
// URL's `data=` param (`!1d{lng}!2d{lat}`), drops the first (origin) and
// last (destination) pair — which are just the fixed Home/Work addresses —
// and returns whatever forced waypoints are in between, in route order.
function extractWaypoints(mapsUrl) {
  const pairs = [...mapsUrl.matchAll(/!1d(-?[\d.]+)!2d(-?[\d.]+)/g)]
    .map(m => ({ lng: parseFloat(m[1]), lat: parseFloat(m[2]) }));
  return pairs.slice(1, -1);
}

module.exports = { loadRows, isPeakNow, getApplicableRoutes, extractWaypoints };
