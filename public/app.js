let currentLat = null;
let currentLng = null;

async function init() {
  const cfg = await fetch('/config').then(r => r.json());
  document.getElementById('workAddr').textContent = cfg.work.address;
  document.getElementById('homeAddr').textContent = cfg.home.address;
  document.getElementById('hourlyRate').value = cfg.defaultHourlyRate;
}

function useCurrentLocation() {
  const status = document.getElementById('geoStatus');
  const btn = document.getElementById('btnGeo');
  btn.disabled = true;
  status.textContent = 'Locating…';

  navigator.geolocation.getCurrentPosition(
    pos => {
      currentLat = pos.coords.latitude;
      currentLng = pos.coords.longitude;
      status.textContent = `📍 ${currentLat.toFixed(4)}, ${currentLng.toFixed(4)}`;
      btn.textContent = '📍 Location set — click again to update';
      btn.disabled = false;
    },
    err => {
      status.textContent = `Location error: ${err.message}`;
      btn.disabled = false;
    }
  );
}

async function optimize(direction) {
  const hourlyRate = document.getElementById('hourlyRate').value;
  const statusEl = document.getElementById('status');

  statusEl.textContent = 'Scraping Google Maps — this takes 30–60 seconds…';
  statusEl.classList.remove('hidden', 'error');

  document.getElementById('btnToHome').disabled = true;
  document.getElementById('btnToWork').disabled = true;

  const body = { direction, hourlyRate };
  if (currentLat !== null) {
    body.originLat = currentLat;
    body.originLng = currentLng;
  }

  try {
    const resp = await fetch('/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || 'Server error');
    }

    const data = await resp.json();
    sessionStorage.setItem('commuteResults', JSON.stringify(data));
    window.location.href = '/results.html';
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.classList.add('error');
  } finally {
    document.getElementById('btnToHome').disabled = false;
    document.getElementById('btnToWork').disabled = false;
  }
}

init();
