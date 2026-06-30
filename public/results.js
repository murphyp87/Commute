function init() {
  const raw = sessionStorage.getItem('commuteResults');
  if (!raw) {
    document.getElementById('resultsList').innerHTML = '<p>No results — <a href="/">go back and run a search</a>.</p>';
    return;
  }

  const data = JSON.parse(raw);
  const meta = document.getElementById('resultsMeta');
  const dirLabel = data.direction === 'toHome' ? 'To Home' : 'To Work';
  meta.innerHTML = `<strong>${dirLabel}</strong> &nbsp;·&nbsp; From: ${data.origin} &nbsp;·&nbsp; Rate: $${data.hourlyRate}/hr`;

  const list = document.getElementById('resultsList');
  list.innerHTML = data.results.map(r => buildCard(r)).join('');
}

function buildCard(r) {
  const timeStr = r.driveTimeMinutes !== null ? formatTime(r.driveTimeMinutes) : '—';
  const tollStr = r.tollCost !== null ? `$${r.tollCost.toFixed(2)}` : '—';
  const scoreStr = r.score !== null ? `$${r.score.toFixed(2)}` : '—';

  const tollDetail = r.tollBreakdown
    .filter(s => s.cost !== null)
    .map(s => `${s.name}: $${s.cost.toFixed(2)}`)
    .join(', ') || 'No tolls';

  const placeholders = r.tollBreakdown.filter(s => s.placeholder);
  const placeholderNote = placeholders.length
    ? `<div class="placeholder-warn">⚠ ${placeholders.map(s => s.name).join(', ')} not yet populated in ezpass-rates.json</div>`
    : '';

  return `
    <div class="result-card rank-${r.rank}">
      <div class="result-rank">#${r.rank}</div>
      <div class="result-body">
        <div class="result-label">${r.label}</div>
        <div class="result-stats">
          <span class="stat"><span class="stat-label">Time</span> ${timeStr}</span>
          <span class="stat"><span class="stat-label">Tolls</span> ${tollStr}</span>
          <span class="stat score"><span class="stat-label">Score</span> ${scoreStr}</span>
        </div>
        <div class="toll-detail">${tollDetail}</div>
        ${placeholderNote}
        <div class="explanation">${r.explanation}</div>
        <a class="maps-link" href="${r.mapsUrl}" target="_blank" rel="noopener">Open in Google Maps ↗</a>
      </div>
    </div>
  `;
}

function formatTime(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
}

init();
