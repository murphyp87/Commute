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

  document.getElementById('resultsMeta').innerHTML =
    `<span class="meta-dir">${dirLabel}</span>` +
    `<span class="meta-sep">·</span>` +
    `<span class="meta-from">from ${fromLabel}</span>` +
    `<span class="meta-sep">·</span>` +
    `<span class="meta-rate">$${data.hourlyRate}/hr</span>`;

  const list = document.getElementById('resultsList');
  if (!data.results || data.results.length === 0) {
    list.innerHTML = '<p class="no-results">No routes could be ranked. Check the server console for scraper errors.</p>';
    return;
  }

  list.innerHTML = data.results.map(r => buildCard(r)).join('');
}

function buildCard(r) {
  const timeStr   = r.driveTimeMinutes != null ? formatTime(r.driveTimeMinutes) : '—';
  const tollStr   = `$${r.tollCost.toFixed(2)}`;
  const scoreStr  = r.score != null ? `$${r.score.toFixed(2)}` : '—';
  const rankClass = r.rank <= 3 ? `rank-${r.rank}` : 'rank-other';

  // Toll line: summarise segments with real costs; flag placeholders
  const realTolls = r.tollBreakdown.filter(s => s.cost != null && s.cost > 0);
  const placeholders = r.tollBreakdown.filter(s => s.placeholder);
  const tollLines = realTolls.length
    ? realTolls.map(s => `${s.name} $${s.cost.toFixed(2)}`).join(' + ')
    : 'No tolls';
  const placeholderNote = placeholders.length
    ? `<div class="placeholder-warn">⚠ ${placeholders.map(s => s.name).join(', ')} cost not set in ezpass-rates.json</div>`
    : '';

  const failedNote = r.driveTimeMinutes == null
    ? '<div class="failed-note">⚠ Could not retrieve drive time — see server console</div>'
    : '';

  return `
    <div class="result-card ${rankClass}">
      <div class="result-rank">#${r.rank}</div>
      <div class="result-body">
        <div class="result-label">${r.label}</div>
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
        <div class="toll-detail">${tollLines}</div>
        ${placeholderNote}
        ${failedNote}
        <div class="explanation">${r.explanation}</div>
        <a class="maps-link" href="${r.mapsUrl}" target="_blank" rel="noopener noreferrer">
          Open in Google Maps ↗
        </a>
      </div>
    </div>`;
}

function formatTime(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
}

init();
