(() => {
  'use strict';

  const LS_KEY = 'mortle-stats';
  const LS_DIFF_KEY = 'mortle-difficulty';
  const LS_GIRLY_KEY = 'mortle-girlypop';
  const LS_HIST_KEY = 'mortle-history';
  const HISTORY_MAX = 40;
  const HISTORY_AVOIDANCE = 0.9;
  const HISTORY_HALF_LIFE = 12;
  const ROUNDS = 10;
  const FIT_MAX_ZOOM = 6;
  const HINT_FACTORS = { occupation: 0.5, cause: 0.5, image: 0.25, blurb: 0.125 };

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
    girlypopToggle: $('girlypopToggle'),
    girlypopNote: $('girlypopNote'),
    statsBtn: $('statsBtn'),
    statsModal: $('statsModal'),
    statsClose: $('statsClose'),
    modalScore: $('modalScore'),
    modalBestStreak: $('modalBestStreak'),
    hintBtn: $('hintBtn'),
    hintMenu: $('hintMenu'),
    hintsArea: $('hintsArea'),
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
  let girlypop = loadGirlypop();
  let history = loadHistory();
  let hintFactor = 1;
  let hintsTaken = new Set();

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

  // Pick a session while avoiding immediate repeats: figures answered
  // correctly in recent rounds get a low weight that recovers slowly
  // (half-life) toward 1. Figures the player got wrong are left at full
  // weight so they repeat soon and the player can learn them.
  function selectSession(pool) {
    if (pool.length <= ROUNDS) return shuffle(pool);
    const lastIdx = new Map();
    history.forEach((entry, i) => lastIdx.set(entry.name, i));
    const weights = pool.map((f) => {
      const li = lastIdx.get(f.name);
      if (li === undefined) return 1;
      if (!history[li].correct) return 1;
      const recency = history.length - 1 - li;
      return Math.max(0.05, 1 - HISTORY_AVOIDANCE * Math.pow(0.5, recency / HISTORY_HALF_LIFE));
    });
    return weightedSample(pool, weights, ROUNDS);
  }

  function weightedSample(pool, weights, n) {
    const remaining = pool.map((f, i) => ({ f, w: weights[i] }));
    const result = [];
    while (result.length < n && remaining.length) {
      const total = remaining.reduce((s, x) => s + x.w, 0);
      let r = Math.random() * total;
      let pick = remaining.length - 1;
      for (let i = 0; i < remaining.length; i++) {
        r -= remaining[i].w;
        if (r <= 0) { pick = i; break; }
      }
      result.push(remaining[pick].f);
      remaining.splice(pick, 1);
    }
    return result;
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
    const color = kind === 'birth' ? (girlypop ? '#f07eb6' : '#35c05f') : (girlypop ? '#a871c8' : '#e5524b');
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
      { padding: [70, 70], maxZoom: FIT_MAX_ZOOM, animate: true }
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
    const effMax = girlypop ? Math.max(maxDifficulty, 2) : maxDifficulty;
    const pool = figures.filter(
      (f) => (girlypop ? f.gender === 'woman' : true) && f.difficulty <= effMax
    );
    session = selectSession(pool);
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
    resetHints();
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

  // ---------- hints ----------

  function fmtFactor(f) {
    const n = Math.round(f * 100000) / 100000;
    return String(n).replace(/\.?0+$/, '');
  }

  function resetHints() {
    hintFactor = 1;
    hintsTaken = new Set();
    els.hintsArea.innerHTML = '';
    hide(els.hintMenu);
    els.hintMenu.querySelectorAll('.hint-option').forEach((btn) => (btn.disabled = false));
  }

  function updateHintUi() {
    let mult = els.hintsArea.querySelector('.hint-multiplier');
    if (!mult) {
      mult = document.createElement('p');
      mult.className = 'hint-multiplier';
      els.hintsArea.prepend(mult);
    }
    mult.textContent = 'Hint multiplier: \u00d7' + fmtFactor(hintFactor);
    els.hintMenu.querySelectorAll('.hint-option').forEach((btn) => {
      btn.disabled = hintsTaken.has(btn.dataset.hint);
    });
  }

  function takeHint(kind) {
    if (hintsTaken.has(kind) || roundIdx >= session.length) return;
    const cur = session[roundIdx];
    hintsTaken.add(kind);
    hintFactor *= HINT_FACTORS[kind];

    const el = document.createElement('div');
    if (kind === 'image') {
      el.className = 'hint-image';
      const img = document.createElement('img');
      img.alt = 'Portrait';
      img.hidden = true;
      const fb = document.createElement('div');
      fb.className = 'portrait-fallback';
      fb.hidden = true;
      el.appendChild(img);
      el.appendChild(fb);
      loadPortraitInto(img, fb, cur.images || [], cur.name);
    } else {
      el.className = 'hint-fact';
      const label = kind === 'occupation' ? 'Occupation' : kind === 'cause' ? 'Cause of death' : 'Blurb';
      const strong = document.createElement('strong');
      strong.textContent = label + ': ';
      const text = document.createTextNode(
        kind === 'occupation' ? cur.occupation : kind === 'cause' ? cur.cause_of_death : cur.blurb || ''
      );
      el.appendChild(strong);
      el.appendChild(text);
    }
    els.hintsArea.appendChild(el);
    updateHintUi();
    hide(els.hintMenu);
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
      const award = Math.pow(0.5, attempts - 1) * hintFactor;
      score += award;
      streak++;
      stats.points += award;
      stats.totalCorrect++;
      stats.bestStreak = Math.max(stats.bestStreak, streak);
      saveStats();
      updateHud();
      showReveal(award, false);
    } else {
      const nextAward = Math.pow(0.5, attempts) * hintFactor;
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
    recordRound(cur, !skipped);
    const hintCount = hintsTaken.size;
    const hintNote =
      hintCount > 0
        ? ' with ' + hintCount + ' ' + (hintCount === 1 ? 'hint' : 'hints')
        : '';
    els.revealStatus.textContent = skipped
      ? 'Skipped. No points'
      : (award === 1
          ? 'Correct on the first try'
          : 'Correct after ' + attempts + ' ' + (attempts === 1 ? 'try' : 'tries')) + hintNote + '!';
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

  function loadPortraitInto(img, fb, urls, name) {
    img.hidden = true;
    fb.hidden = true;
    const initials = name
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

  function loadPortrait(urls) {
    loadPortraitInto(els.portrait, els.portraitFallback, urls, els.revealName.textContent);
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
      return v >= 1 && v <= 5 ? v : 1;
    } catch (e) {
      return 1;
    }
  }

  function saveDifficulty(v) {
    try {
      localStorage.setItem(LS_DIFF_KEY, String(v));
    } catch (e) {
      /* ignore */
    }
  }

  function loadGirlypop() {
    try {
      return localStorage.getItem(LS_GIRLY_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function saveGirlypop() {
    try {
      localStorage.setItem(LS_GIRLY_KEY, girlypop ? '1' : '0');
    } catch (e) {
      /* ignore */
    }
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(LS_HIST_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      return arr
        .map((e) => (typeof e === 'string' ? { name: e, correct: true } : e))
        .filter((e) => e && typeof e.name === 'string' && typeof e.correct === 'boolean');
    } catch (e) {
      return [];
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(LS_HIST_KEY, JSON.stringify(history));
    } catch (e) {
      /* ignore */
    }
  }

  function recordRound(figure, correct) {
    history.push({ name: figure.name, correct: !!correct });
    if (history.length > HISTORY_MAX) history = history.slice(-HISTORY_MAX);
    saveHistory();
  }

  // Girlypop mode: women only, and there aren't enough difficulty-1 women,
  // so the minimum difficulty becomes 2.
  function applyGirlypopUi() {
    document.body.classList.toggle('girlypop', girlypop);
    els.girlypopToggle.checked = girlypop;
    els.difficultySlider.min = girlypop ? '2' : '1';
    if (girlypop) show(els.girlypopNote);
    else hide(els.girlypopNote);
    if (girlypop && maxDifficulty < 2) {
      maxDifficulty = 2;
      els.difficultySlider.value = 2;
      els.difficultyValue.textContent = 2;
      els.diffLabel.textContent = 2;
      saveDifficulty(2);
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

  els.girlypopToggle.addEventListener('change', () => {
    girlypop = els.girlypopToggle.checked;
    saveGirlypop();
    applyGirlypopUi();
    startGame();
  });

  els.hintBtn.addEventListener('click', () => {
    if (roundIdx >= session.length) return;
    els.hintMenu.classList.toggle('hidden');
  });

  els.hintMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('.hint-option');
    if (!btn || btn.disabled) return;
    takeHint(btn.dataset.hint, btn);
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
    applyGirlypopUi();
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
