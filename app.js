(() => {
  'use strict';

  const LS_KEY = 'mortle-stats';
  const LS_DIFF_KEY = 'mortle-difficulty';
  const ROUNDS = 10;
  const FIT_MAX_ZOOM = 9;

  const DEFAULT_STATS = { points: 0, bestStreak: 0, gamesPlayed: 0, totalCorrect: 0 };

  const $ = (id) => document.getElementById(id);

  const els = {
    round: $('roundLabel'),
    score: $('scoreLabel'),
    streak: $('streakLabel'),
    resetView: $('resetView'),
    loadError: $('loadError'),
    gamePanel: $('gamePanel'),
    guessForm: $('guessForm'),
    guessInput: $('guessInput'),
    feedback: $('feedback'),
    skipBtn: $('skipBtn'),
    revealPanel: $('revealPanel'),
    portrait: $('portrait'),
    portraitFallback: $('portraitFallback'),
    revealStatus: $('revealStatus'),
    revealName: $('revealName'),
    revealAliases: $('revealAliases'),
    revealMeta: $('revealMeta'),
    revealOccupation: $('revealOccupation'),
    revealCod: $('revealCod'),
    revealBirth: $('revealBirth'),
    revealDeath: $('revealDeath'),
    revealAge: $('revealAge'),
    roundPoints: $('roundPoints'),
    nextBtn: $('nextBtn'),
    resultsPanel: $('resultsPanel'),
    resultsTitle: $('resultsTitle'),
    resultsScore: $('resultsScore'),
    bestStreak: $('bestStreak'),
    gamesPlayed: $('gamesPlayed'),
    lifetimePoints: $('lifetimePoints'),
    totalCorrect: $('totalCorrect'),
    playAgainBtn: $('playAgainBtn'),
    difficultySlider: $('difficultySlider'),
    difficultyValue: $('difficultyValue'),
    difficultySection: $('difficultySection'),
    diffLabel: $('diffLabel'),
    statsBtn: $('statsBtn'),
    statsModal: $('statsModal'),
    statsClose: $('statsClose'),
    modalScore: $('modalScore'),
    modalBestStreak: $('modalBestStreak'),
    modalGamesPlayed: $('modalGamesPlayed'),
    modalLifetimePoints: $('modalLifetimePoints'),
    modalTotalCorrect: $('modalTotalCorrect'),
  };

  let figures = [];
  let session = [];
  let roundIdx = 0;
  let attempts = 0;
  let score = 0;
  let streak = 0;
  let stats = loadStats();
  let maxDifficulty = loadDifficulty();

  let map = null;

  // ---------- small utilities ----------

  function show(el) { el.classList.remove('hidden'); }
  function hide(...elsToHide) { elsToHide.forEach((el) => el && el.classList.add('hidden')); }
  function shake(el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }

  function fmtYear(y) {
    return y < 0 ? Math.abs(y) + ' BC' : String(y);
  }

  function fmtPoints(p) {
    const n = Math.round(p * 100) / 100;
    return n === 1 ? '1 point' : n + ' points';
  }

  function fmtAge(birthYear, deathYear) {
    const age = deathYear - birthYear;
    return age + ' years old';
  }

  function fmtScore(n) {
    return String(Math.round(n * 100) / 100);
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- answer matching ----------

  function normalize(s) {
    return (s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) d[i][0] = i;
    for (let j = 0; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        d[i][j] = a[i - 1] === b[j - 1]
          ? d[i - 1][j - 1]
          : 1 + Math.min(d[i - 1][j], d[i][j - 1], d[i - 1][j - 1]);
      }
    }
    return d[m][n];
  }

  function addTargets(set, phrase) {
    const norm = normalize(phrase);
    if (!norm) return;
    const tokens = norm.split(' ');
    set.add(norm);
    set.add(tokens[tokens.length - 1]);
    if (tokens.length > 2) set.add(tokens.slice(-2).join(' '));
    tokens.forEach((t) => set.add(t));
  }

  function checkGuess(input, figure) {
    const guess = normalize(input);
    if (!guess) return false;
    const targets = new Set();
    addTargets(targets, figure.name);
    (figure.aliases || []).forEach((alias) => addTargets(targets, alias));
    for (const t of targets) {
      if (guess === t) return true;
      if (levenshtein(guess, t) <= Math.max(2, Math.floor(t.length * 0.25))) return true;
    }
    return false;
  }

  // ---------- map ----------

  function initMap() {
    map = L.map('map', { minZoom: 2, maxZoom: 15, worldCopyJump: true }).setView([20, 0], 2);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20,
    }).addTo(map);
  }

  function addMarker(latlng, kind, label, direction) {
    const color = kind === 'birth' ? '#35c05f' : '#e5524b';
    L.circleMarker(latlng, {
      radius: 15, color, weight: 2.5, fillColor: color, fillOpacity: 0.12,
    }).addTo(map);
    const dot = L.circleMarker(latlng, {
      radius: 6, color: '#ffffff', weight: 2, fillColor: color, fillOpacity: 1,
    }).addTo(map);
    dot.bindTooltip(label, {
      permanent: true,
      direction: direction,
      className: 'fig-label ' + (kind === 'birth' ? 'fig-label-birth' : 'fig-label-death'),
    }).openTooltip();
  }

  function clearMarkers() {
    map.eachLayer((layer) => {
      if (layer instanceof L.CircleMarker || layer instanceof L.Tooltip) {
        layer.remove();
      }
    });
  }

  function fitView() {
    const cur = session[roundIdx];
    if (!cur) return;
    map.fitBounds(
      L.latLngBounds([
        [cur.birth.lat, cur.birth.lng],
        [cur.death.lat, cur.death.lng],
      ]),
      { padding: [36, 36], maxZoom: FIT_MAX_ZOOM, animate: true }
    );
  }

  function renderMap(figure) {
    clearMarkers();
    const b = [figure.birth.lat, figure.birth.lng];
    const d = [figure.death.lat, figure.death.lng];
    const close = Math.abs(b[0] - d[0]) + Math.abs(b[1] - d[1]) < 0.5;
    addMarker(b, 'birth', 'born ' + fmtYear(figure.birth.year), close ? 'right' : 'top');
    addMarker(d, 'death', 'died ' + fmtYear(figure.death.year), close ? 'left' : 'bottom');
    fitView();
  }

  // ---------- game flow ----------

  function startGame() {
    const pool = figures.filter((f) => f.difficulty <= maxDifficulty);
    session = shuffle(pool).slice(0, ROUNDS);
    roundIdx = 0;
    score = 0;
    streak = 0;
    stats.gamesPlayed++;
    saveStats();
    startRound();
  }

  function startRound() {
    attempts = 0;
    if (roundIdx >= session.length) {
      showResults();
      return;
    }
    els.feedback.textContent = '';
    els.feedback.className = 'feedback';
    els.guessInput.value = '';
    renderMap(session[roundIdx]);
    hide(els.revealPanel, els.resultsPanel, els.loadError);
    show(els.gamePanel);
    updateHud();
    els.guessInput.focus();
  }

  function updateHud() {
    els.round.textContent = roundIdx >= session.length ? 'Done' : roundIdx + 1 + '/' + session.length;
    els.score.textContent = fmtScore(score);
    els.streak.textContent = streak;
  }

  function handleGuess(e) {
    e.preventDefault();
    if (roundIdx >= session.length) return;
    const cur = session[roundIdx];
    const val = els.guessInput.value;
    if (!val.trim()) {
      els.guessInput.focus();
      return;
    }

    attempts++;

    if (checkGuess(val, cur)) {
      const award = Math.pow(0.5, attempts - 1);
      score += award;
      streak++;
      stats.points += award;
      stats.totalCorrect++;
      stats.bestStreak = Math.max(stats.bestStreak, streak);
      saveStats();
      updateHud();
      showReveal(award, false);
    } else {
      const nextAward = Math.pow(0.5, attempts);
      els.feedback.textContent =
        'Not quite, try again (' + fmtPoints(nextAward) + ' if correct now).';
      els.feedback.className = 'feedback wrong';
      els.guessInput.value = '';
      shake(els.guessInput);
      els.guessInput.focus();
    }
  }

  function showReveal(award, skipped) {
    const cur = session[roundIdx];
    els.revealStatus.textContent = skipped
      ? 'Skipped. No points'
      : award === 1
        ? 'Correct on the first try!'
        : 'Correct after ' + attempts + ' ' + (attempts === 1 ? 'try' : 'tries') + '!';
    els.revealStatus.classList.toggle('skipped', skipped);
    els.revealName.textContent = cur.name;
    if (cur.aliases && cur.aliases.length) {
      els.revealAliases.textContent = 'also known as ' + cur.aliases.join(', ');
      show(els.revealAliases);
    } else {
      els.revealAliases.textContent = '';
      hide(els.revealAliases);
    }
    els.revealMeta.textContent = cur.blurb || '';
    els.revealOccupation.textContent = cur.occupation;
    els.revealCod.textContent = cur.cause_of_death;
    els.revealBirth.textContent = cur.birth.place + ' (' + fmtYear(cur.birth.year) + ')';
    els.revealDeath.textContent = cur.death.place + ' (' + fmtYear(cur.death.year) + ')';
    els.revealAge.textContent = fmtAge(cur.birth.year, cur.death.year);
    els.roundPoints.textContent = skipped ? '' : 'You earned ' + fmtPoints(award);
    els.nextBtn.textContent = roundIdx === session.length - 1 ? 'See results' : 'Next round';
    loadPortrait(cur.images || []);
    hide(els.gamePanel, els.resultsPanel);
    show(els.revealPanel);
    els.guessInput.blur();
  }

  function loadPortrait(urls) {
    const img = els.portrait;
    const fb = els.portraitFallback;
    img.hidden = true;
    fb.hidden = true;
    const initials = els.revealName.textContent
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w.charAt(0))
      .join('')
      .toUpperCase();
    fb.textContent = initials;

    if (!urls.length) {
      fb.hidden = false;
      return;
    }

    let i = 0;
    const tryNext = () => {
      if (i >= urls.length) {
        img.hidden = true;
        fb.hidden = false;
        return;
      }
      img.onerror = () => { i++; tryNext(); };
      img.onload = () => { img.hidden = false; };
      img.src = urls[i++];
    };
    tryNext();
  }

  function showResults() {
    hide(els.gamePanel, els.revealPanel);
    els.resultsTitle.textContent = score >= session.length ? 'Perfect game!' : 'Round complete';
    els.resultsScore.textContent = 'You scored ' + fmtScore(score) + ' / ' + session.length;
    els.bestStreak.textContent = stats.bestStreak;
    els.gamesPlayed.textContent = stats.gamesPlayed;
    els.lifetimePoints.textContent = fmtScore(stats.points);
    els.totalCorrect.textContent = stats.totalCorrect;
    show(els.resultsPanel);
    if (typeof els.resultsPanel.scrollIntoView === 'function') {
      els.resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // ---------- stats modal ----------

  function openStats() {
    els.modalScore.textContent = fmtScore(score);
    els.modalBestStreak.textContent = stats.bestStreak;
    els.modalGamesPlayed.textContent = stats.gamesPlayed;
    els.modalLifetimePoints.textContent = fmtScore(stats.points);
    els.modalTotalCorrect.textContent = stats.totalCorrect;
    show(els.statsModal);
  }

  function closeStats() {
    hide(els.statsModal);
  }

  // ---------- persistence ----------

  function loadStats() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? Object.assign({}, DEFAULT_STATS, JSON.parse(raw)) : Object.assign({}, DEFAULT_STATS);
    } catch (e) {
      return Object.assign({}, DEFAULT_STATS);
    }
  }

  function saveStats() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(stats));
    } catch (e) {
      /* ignore quota / privacy mode */
    }
  }

  function loadDifficulty() {
    try {
      const v = parseInt(localStorage.getItem(LS_DIFF_KEY), 10);
      return v >= 1 && v <= 5 ? v : 5;
    } catch (e) {
      return 5;
    }
  }

  function saveDifficulty(v) {
    try {
      localStorage.setItem(LS_DIFF_KEY, String(v));
    } catch (e) {
      /* ignore */
    }
  }

  // ---------- events ----------

  els.guessForm.addEventListener('submit', handleGuess);
  els.nextBtn.addEventListener('click', () => {
    roundIdx++;
    startRound();
  });
  els.skipBtn.addEventListener('click', () => {
    if (roundIdx >= session.length) return;
    streak = 0;
    saveStats();
    showReveal(0, true);
  });
  els.playAgainBtn.addEventListener('click', startGame);
  els.resetView.addEventListener('click', fitView);

  els.difficultySlider.addEventListener('input', () => {
    maxDifficulty = parseInt(els.difficultySlider.value, 10);
    els.difficultyValue.textContent = maxDifficulty;
    els.diffLabel.textContent = maxDifficulty;
    saveDifficulty(maxDifficulty);
    startGame();
  });

  els.statsBtn.addEventListener('click', openStats);
  els.statsClose.addEventListener('click', closeStats);
  els.statsModal.addEventListener('click', (e) => {
    if (e.target === els.statsModal) closeStats();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeStats();
      return;
    }
    if (e.key !== 'Enter') return;
    if (!els.statsModal.classList.contains('hidden')) {
      e.preventDefault();
      return;
    }
    if (!els.revealPanel.classList.contains('hidden')) {
      e.preventDefault();
      els.nextBtn.click();
    } else if (!els.resultsPanel.classList.contains('hidden')) {
      e.preventDefault();
      els.playAgainBtn.click();
    }
  });

  // ---------- boot ----------

  async function boot() {
    initMap();
    els.difficultySlider.value = maxDifficulty;
    els.difficultyValue.textContent = maxDifficulty;
    els.diffLabel.textContent = maxDifficulty;
    try {
      const res = await fetch('historical_figures_quiz.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      figures = await res.json();
      if (!Array.isArray(figures) || !figures.length) throw new Error('the data file is empty');
      hide(els.loadError);
      startGame();
    } catch (err) {
      hide(els.gamePanel, els.revealPanel, els.resultsPanel);
      els.loadError.textContent =
        'Could not load the quiz data (' + err.message + '). Serve this folder over HTTP ' +
        '(run serve.bat). Opening index.html directly from disk won\u2019t work.';
      show(els.loadError);
    }
  }

  boot();
})();
