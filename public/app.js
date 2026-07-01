// Bump this on every deploy — 3rd digit for most changes, 2nd digit for
// functional/formula changes, 1st digit reserved for major overhauls.
const APP_VERSION = 'v1.1.2';

const STORAGE_KEYS = {
  hourlyRate: 'commute.hourlyRate',
  simMinutes: 'commute.simMinutes',
  simDollars: 'commute.simDollars',
  useMyLocation: 'commute.useMyLocation'
};

async function init() {
  document.getElementById('app-version').textContent = APP_VERSION;

  const useMyLocation = document.getElementById('useMyLocation');
  useMyLocation.checked = load(STORAGE_KEYS.useMyLocation, 'true') === 'true';
  useMyLocation.addEventListener('change', () => {
    localStorage.setItem(STORAGE_KEYS.useMyLocation, useMyLocation.checked);
  });

  try {
    const cfg = await fetch('/config').then(r => r.json());
    document.getElementById('workAddr').textContent = cfg.work.address;
    document.getElementById('homeAddr').textContent = cfg.home.address;

    document.getElementById('hourlyRate').value = load(STORAGE_KEYS.hourlyRate, cfg.defaultHourlyRate);
    document.getElementById('simMinutes').value = load(STORAGE_KEYS.simMinutes, cfg.similarityMinutes);
    document.getElementById('simDollars').value = load(STORAGE_KEYS.simDollars, cfg.similarityDollars);
  } catch (e) {
    document.getElementById('workAddr').textContent = 'Could not load config';
  }
}

// Wraps navigator.geolocation in a Promise; resolves null on any failure
// (unsupported, denied, timeout) so callers can fall back to the fixed
// Home/Work address without special-casing errors.
function getCurrentLocation() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

function load(key, fallback) {
  const stored = localStorage.getItem(key);
  return stored !== null ? stored : fallback;
}

function setStatus(msg, isError = false) {
  const box = document.getElementById('statusBox');
  const text = document.getElementById('statusText');
  text.textContent = msg;
  box.classList.remove('hidden', 'status-error');
  if (isError) {
    box.classList.add('status-error');
    box.querySelector('.spinner').style.display = 'none';
  } else {
    box.querySelector('.spinner').style.display = '';
  }
}

function setButtons(disabled) {
  document.getElementById('btnToHome').disabled = disabled;
  document.getElementById('btnToWork').disabled = disabled;
}

async function optimize(direction) {
  const hourlyRate = parseFloat(document.getElementById('hourlyRate').value) || 25;
  const simMinutes = parseFloat(document.getElementById('simMinutes').value);
  const simDollars = parseFloat(document.getElementById('simDollars').value);

  localStorage.setItem(STORAGE_KEYS.hourlyRate, hourlyRate);
  localStorage.setItem(STORAGE_KEYS.simMinutes, simMinutes);
  localStorage.setItem(STORAGE_KEYS.simDollars, simDollars);

  const dirLabel = direction === 'toHome' ? 'Home' : 'Work';

  setButtons(true);
  document.getElementById('resultsSection').classList.add('hidden');
  setStatus(`Scraping Google Maps for routes to ${dirLabel}… usually under 15 seconds.`);

  const body = {
    direction,
    hourlyRate,
    similarityMinutes: simMinutes,
    similarityDollars: simDollars
  };

  if (document.getElementById('useMyLocation').checked) {
    setStatus('Getting your location…');
    const location = await getCurrentLocation();
    if (location) {
      body.origin = location;
      setStatus(`Scraping Google Maps for routes to ${dirLabel}… usually under 15 seconds.`);
    } else {
      setStatus(`Couldn't get your location — using default address instead. Scraping Google Maps for routes to ${dirLabel}…`);
    }
  }

  try {
    const resp = await fetch('/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await resp.json();

    if (!resp.ok) {
      throw new Error(data.error || `Server error ${resp.status}`);
    }

    document.getElementById('statusBox').classList.add('hidden');
    renderResults(data);
  } catch (err) {
    setStatus(`Error: ${err.message}`, true);
  } finally {
    setButtons(false);
  }
}

function renderResults(data) {
  const section = document.getElementById('resultsSection');
  section.classList.remove('hidden');

  const dirLabel = data.direction === 'toHome' ? '🏠 To Home' : '🏢 To Work';
  const fromLabel = data.origin.length > 40 ? data.origin.slice(0, 40) + '…' : data.origin;
  const peakLabel = data.isPeak ? 'Peak tolls' : 'Off-Peak tolls';

  document.getElementById('resultsMeta').innerHTML =
    `<span class="meta-dir">${dirLabel}</span>` +
    `<span class="meta-sep">·</span>` +
    `<span class="meta-from">from ${fromLabel}</span>` +
    `<span class="meta-sep">·</span>` +
    `<span class="meta-rate">$${data.hourlyRate}/hr</span>` +
    `<span class="meta-sep">·</span>` +
    `<span class="meta-peak">${peakLabel}</span>`;

  const list = document.getElementById('resultsList');
  const toggleBtn = document.getElementById('toggleAllBtn');
  const tableBox = document.getElementById('allRoutesTable');

  if (!data.top3 || data.top3.length === 0) {
    list.innerHTML = '<p class="no-results">No routes could be ranked. Check the server console for scraper errors.</p>';
    toggleBtn.classList.add('hidden');
    tableBox.classList.add('hidden');
    return;
  }

  let html = data.top3.map((r, i) => buildCard(r, { displayRank: i + 1 })).join('');
  if (data.googleDefaultCard) {
    html += buildCard(data.googleDefaultCard, { compact: true });
  }
  list.innerHTML = html;

  tableBox.classList.add('hidden');
  toggleBtn.textContent = '▾ Show all routes';
  if (data.fullList && data.fullList.length > 0) {
    setupAllRoutesTable(data.fullList);
  } else {
    toggleBtn.classList.add('hidden');
  }

  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function buildCard(r, { compact = false, displayRank = null } = {}) {
  const timeStr = r.driveTimeMinutes != null ? formatTime(r.driveTimeMinutes) : '—';
  const tollStr = `$${r.tollCost.toFixed(2)}${r.tollEstimated ? '*' : ''}`;
  const scoreStr = r.score != null ? `$${r.score.toFixed(2)}` : '—';
  const rankClass = !compact && displayRank <= 3 ? `rank-${displayRank}` : 'rank-other';
  const isDefault = r.name === 'Google Default';
  const cardClass = compact ? 'result-card result-card-compact' : `result-card ${rankClass}`;
  const rankBadge = compact
    ? '<div class="default-badge">Google Default</div>'
    : `<div class="result-rank">#${displayRank}</div>`;
  const estimatedNote = r.tollEstimated
    ? isDefault
      ? '<div class="estimated-note">* estimated toll — Google doesn\'t show an exact amount for this route</div>'
      : '<div class="estimated-note">* estimated toll — adjusted for your live location, not exact</div>'
    : '';
  const failedNote = r.driveTimeMinutes == null
    ? '<div class="failed-note">⚠ Could not retrieve drive time — see server console</div>'
    : '';

  return `
    <a class="${cardClass}" href="${r.mapsUrl}" target="_blank" rel="noopener noreferrer">
      ${rankBadge}
      <div class="result-body">
        <div class="result-label">${isDefault ? "Google's suggested route" : r.name}</div>
        <div class="result-stats">
          <div class="stat">
            <div class="stat-val">${timeStr}</div>
            <div class="stat-key">Drive time</div>
          </div>
          <div class="stat-divider"></div>
          <div class="stat">
            <div class="stat-val">${tollStr}</div>
            <div class="stat-key">Tolls</div>
          </div>
          <div class="stat-divider"></div>
          <div class="stat stat-score">
            <div class="stat-val">${scoreStr}</div>
            <div class="stat-key">Score</div>
          </div>
        </div>
        ${estimatedNote}
        ${failedNote}
        ${compact ? '' : `<div class="explanation">${r.explanation}</div>`}
      </div>
    </a>`;
}

function setupAllRoutesTable(fullList) {
  const toggleBtn = document.getElementById('toggleAllBtn');
  const tableBox = document.getElementById('allRoutesTable');
  toggleBtn.classList.remove('hidden');

  const rows = fullList.map(r => {
    const timeStr = r.driveTimeMinutes != null ? formatTime(r.driveTimeMinutes) : '—';
    const tollStr = r.driveTimeMinutes != null ? `$${r.tollCost.toFixed(2)}${r.tollEstimated ? '*' : ''}` : '—';
    const scoreStr = r.score != null ? `$${r.score.toFixed(2)}` : '—';
    const label = r.name === 'Google Default' ? "Google's suggested route" : r.name;
    return `
      <a class="all-routes-row" href="${r.mapsUrl}" target="_blank" rel="noopener noreferrer">
        <span class="ar-name">${label}</span>
        <span class="ar-time">${timeStr}</span>
        <span class="ar-toll">${tollStr}</span>
        <span class="ar-score">${scoreStr}</span>
      </a>`;
  }).join('');

  tableBox.innerHTML = `
    <div class="all-routes-header">
      <span class="ar-name">Route</span>
      <span class="ar-time">Time</span>
      <span class="ar-toll">Toll</span>
      <span class="ar-score">Score</span>
    </div>
    ${rows}`;

  // Assign via onclick (not addEventListener) so re-rendering results across
  // repeated searches replaces the handler instead of stacking duplicates.
  toggleBtn.onclick = () => {
    const isHidden = tableBox.classList.contains('hidden');
    tableBox.classList.toggle('hidden');
    toggleBtn.textContent = isHidden ? '▴ Hide all routes' : '▾ Show all routes';
  };
}

function formatTime(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
}

function initSettingsMenu() {
  const menuBtn = document.getElementById('menuBtn');
  const panel = document.getElementById('settingsPanel');

  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = panel.hasAttribute('hidden');
    if (isHidden) {
      panel.removeAttribute('hidden');
      menuBtn.setAttribute('aria-expanded', 'true');
    } else {
      panel.setAttribute('hidden', '');
      menuBtn.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('click', (e) => {
    if (!panel.hasAttribute('hidden') && !panel.contains(e.target) && e.target !== menuBtn) {
      panel.setAttribute('hidden', '');
      menuBtn.setAttribute('aria-expanded', 'false');
    }
  });

  panel.addEventListener('click', (e) => e.stopPropagation());

  ['hourlyRate', 'simMinutes', 'simDollars'].forEach(id => {
    document.getElementById(id).addEventListener('change', (e) => {
      localStorage.setItem(STORAGE_KEYS[id], e.target.value);
    });
  });
}

init();
initSettingsMenu();
