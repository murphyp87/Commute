function init() {
  const raw = sessionStorage.getItem('commuteResults');
  if (!raw) {
    document.getElementById('resultsList').innerHTML =
      '<p class="no-results">No results found. <a href="/">Go back and run a search.</a></p>';
    return;
  }

  const data = JSON.parse(raw);
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
  if (!data.top3 || data.top3.length === 0) {
    list.innerHTML = '<p class="no-results">No routes could be ranked. Check the server console for scraper errors.</p>';
    return;
  }

  let html = data.top3.map((r, i) => buildCard(r, { displayRank: i + 1 })).join('');
  if (data.googleDefaultCard) {
    html += buildCard(data.googleDefaultCard, { compact: true });
  }
  list.innerHTML = html;

  if (data.fullList && data.fullList.length > 0) {
    setupAllRoutesTable(data.fullList);
  }
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
    ? '<div class="estimated-note">* estimated toll — Google doesn\'t show an exact amount for this route</div>'
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

  toggleBtn.addEventListener('click', () => {
    const isHidden = tableBox.classList.contains('hidden');
    tableBox.classList.toggle('hidden');
    toggleBtn.textContent = isHidden ? '▴ Hide all routes' : '▾ Show all routes';
  });
}

function formatTime(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
}

init();
