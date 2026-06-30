let currentLat = null;
let currentLng = null;

async function init() {
  try {
    const cfg = await fetch('/config').then(r => r.json());
    document.getElementById('workAddr').textContent = cfg.work.address;
    document.getElementById('homeAddr').textContent = cfg.home.address;
    document.getElementById('hourlyRate').value = cfg.defaultHourlyRate;
  } catch (e) {
    document.getElementById('workAddr').textContent = 'Could not load config';
  }
}

function useCurrentLocation() {
  if (!navigator.geolocation) {
    setGeoStatus('Geolocation not supported by this browser.');
    return;
  }
  const btn = document.getElementById('btnGeo');
  btn.disabled = true;
  setGeoStatus('Locating…');

  navigator.geolocation.getCurrentPosition(
    pos => {
      currentLat = pos.coords.latitude;
      currentLng = pos.coords.longitude;
      setGeoStatus(`📍 ${currentLat.toFixed(5)}, ${currentLng.toFixed(5)} — will be used as start`);
      btn.textContent = '📍 Update my location';
      btn.disabled = false;
    },
    err => {
      setGeoStatus(`Could not get location: ${err.message}`);
      btn.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function setGeoStatus(msg) {
  document.getElementById('geoStatus').textContent = msg;
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
  document.getElementById('btnGeo').disabled = disabled;
}

async function optimize(direction) {
  const hourlyRate = parseFloat(document.getElementById('hourlyRate').value) || 25;
  const dirLabel = direction === 'toHome' ? 'Home' : 'Work';

  setButtons(true);
  setStatus(`Scraping Google Maps for all routes to ${dirLabel}… this takes about 2 minutes.`);

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

    const data = await resp.json();

    if (!resp.ok) {
      throw new Error(data.error || `Server error ${resp.status}`);
    }

    sessionStorage.setItem('commuteResults', JSON.stringify(data));
    window.location.href = '/results.html';
  } catch (err) {
    setStatus(`Error: ${err.message}`, true);
    setButtons(false);
  }
}

init();
