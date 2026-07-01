const STORAGE_KEYS = {
  hourlyRate: 'commute.hourlyRate',
  simMinutes: 'commute.simMinutes',
  simDollars: 'commute.simDollars'
};

async function init() {
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
  setStatus(`Scraping Google Maps for routes to ${dirLabel}… usually under 15 seconds.`);

  const body = {
    direction,
    hourlyRate,
    similarityMinutes: simMinutes,
    similarityDollars: simDollars
  };

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
