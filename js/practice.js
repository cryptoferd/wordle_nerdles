const API_BASE = 'https://wordlehints.co.uk/wp-json/wordlehint/v1/answers';
const WORDLIST_URL = 'https://cdn.jsdelivr.net/gh/nolanlad/nyt_wordle_word_list@main/nyt_wordle_list.py';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_KEY = 'wordlePracticeAnswers:v1';
const WORDLIST_CACHE_KEY = 'wordlePracticeAllowedWords:v1';
const MAX_ROWS = 6;
const WORD_LENGTH = 5;
const KEYBOARD_ROWS = [
  ['Q','W','E','R','T','Y','U','I','O','P'],
  ['A','S','D','F','G','H','J','K','L'],
  ['ENTER','Z','X','C','V','B','N','M','⌫'],
];

const state = {
  allAnswers: [],
  allowedWords: new Set(),
  answer: '',
  answerMeta: null,
  guesses: [],
  currentGuess: '',
  statuses: {},
  isComplete: false,
};

const el = {
  board: document.getElementById('practice-board'),
  keyboard: document.getElementById('practice-keyboard'),
  status: document.getElementById('practice-status'),
  meta: document.getElementById('practice-meta'),
  currentGuess: document.getElementById('practice-current-guess'),
  newGame: document.getElementById('practice-new-game'),
  reveal: document.getElementById('practice-reveal'),
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function setStatus(message, variant = '') {
  el.status.textContent = message;
  el.status.className = variant ? `badge ${variant}` : 'badge';
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.cachedAt || !Array.isArray(parsed?.answers)) return null;
    if (Date.now() - parsed.cachedAt > CACHE_TTL_MS) return null;
    return parsed.answers;
  } catch {
    return null;
  }
}

function writeCache(answers) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      cachedAt: Date.now(),
      answers,
    }));
  } catch {
    // ignore storage issues
  }
}

function readWordlistCache() {
  try {
    const raw = localStorage.getItem(WORDLIST_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.cachedAt || !Array.isArray(parsed?.words)) return null;
    if (Date.now() - parsed.cachedAt > CACHE_TTL_MS) return null;
    return parsed.words;
  } catch {
    return null;
  }
}

function writeWordlistCache(words) {
  try {
    localStorage.setItem(WORDLIST_CACHE_KEY, JSON.stringify({
      cachedAt: Date.now(),
      words,
    }));
  } catch {
    // ignore storage issues
  }
}

function parsePythonWordList(sourceText) {
  const matches = sourceText.match(/'([a-z]{5})'|"([a-z]{5})"/gi) || [];
  const words = [...new Set(
    matches.map((token) => token.slice(1, -1).toLowerCase()).filter((word) => /^[a-z]{5}$/.test(word))
  )];
  return words;
}

async function fetchAllowedWords() {
  const cached = readWordlistCache();
  if (cached?.length) {
    return cached;
  }

  const response = await fetch(WORDLIST_URL);
  if (!response.ok) {
    throw new Error('Could not load the practice word list.');
  }

  const text = await response.text();
  const words = parsePythonWordList(text);
  if (!words.length) {
    throw new Error('Practice word list was empty.');
  }

  writeWordlistCache(words);
  return words;
}

async function fetchAllAnswers() {
  const cached = readCache();
  if (cached?.length) {
    el.meta.textContent = 'Answer archive loaded from browser cache.';
    return cached;
  }

  let page = 1;
  const perPage = 100;
  let hasMore = true;
  const all = [];

  while (hasMore) {
    const url = `${API_BASE}?page=${page}&per_page=${perPage}&order=desc`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Could not load the past answers list.');
    }
    const data = await response.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    all.push(...results);
    hasMore = Boolean(data?.has_more);
    page += 1;
    if (page > 100) break;
  }

  const normalized = all
    .filter((item) => typeof item?.answer === 'string')
    .map((item) => ({
      answer: item.answer.trim().toUpperCase(),
      game: item.game,
      date: item.date,
      day_name: item.day_name,
      difficulty: item.difficulty,
    }))
    .filter((item) => /^[A-Z]{5}$/.test(item.answer));

  writeCache(normalized);
  el.meta.textContent = 'Answer archive loaded from API and cached locally for 12 hours.';
  return normalized;
}

function chooseRandomAnswer() {
  if (!state.allAnswers.length) return null;
  const index = Math.floor(Math.random() * state.allAnswers.length);
  return state.allAnswers[index];
}

function scoreGuess(guess, answer) {
  const result = Array(WORD_LENGTH).fill('gray');
  const answerChars = answer.split('');
  const guessChars = guess.split('');
  const used = Array(WORD_LENGTH).fill(false);

  // greens
  for (let i = 0; i < WORD_LENGTH; i += 1) {
    if (guessChars[i] === answerChars[i]) {
      result[i] = 'green';
      used[i] = true;
    }
  }

  // yellows
  for (let i = 0; i < WORD_LENGTH; i += 1) {
    if (result[i] === 'green') continue;
    const idx = answerChars.findIndex((char, j) => !used[j] && char === guessChars[i]);
    if (idx !== -1) {
      result[i] = 'yellow';
      used[idx] = true;
    }
  }

  return result;
}

function mergeKeyStatus(oldStatus, newStatus) {
  const rank = { gray: 1, yellow: 2, green: 3 };
  if (!oldStatus) return newStatus;
  return rank[newStatus] > rank[oldStatus] ? newStatus : oldStatus;
}

function renderBoard() {
  const rows = [];
  for (let rowIndex = 0; rowIndex < MAX_ROWS; rowIndex += 1) {
    let letters = [];
    let classes = [];
    if (rowIndex < state.guesses.length) {
      const guess = state.guesses[rowIndex];
      letters = guess.word.split('');
      classes = guess.score;
    } else if (rowIndex === state.guesses.length && !state.isComplete) {
      letters = state.currentGuess.split('');
      classes = Array(letters.length).fill('filled');
    }
    while (letters.length < WORD_LENGTH) letters.push('');
    while (classes.length < WORD_LENGTH) classes.push('');
    rows.push({ letters, classes });
  }

  el.board.innerHTML = rows.map((row) => `
    <div class="practice-row">
      ${row.letters.map((letter, index) => `
        <div class="practice-tile ${row.classes[index]}">${escapeHtml(letter)}</div>
      `).join('')}
    </div>
  `).join('');

  el.currentGuess.textContent = state.currentGuess || '—';
}

function renderKeyboard() {
  el.keyboard.innerHTML = KEYBOARD_ROWS.map((row) => `
    <div class="practice-key-row">
      ${row.map((key) => {
        const statusClass = /^[A-Z]$/.test(key) ? (state.statuses[key] || '') : '';
        const specialClass = key === 'ENTER' || key === '⌫' ? 'wide' : '';
        return `<button type="button" class="practice-key ${statusClass} ${specialClass}" data-key="${key}">${key}</button>`;
      }).join('')}
    </div>
  `).join('');

  el.keyboard.querySelectorAll('[data-key]').forEach((button) => {
    button.addEventListener('click', () => handleKey(button.dataset.key));
  });
}

function renderAll() {
  renderBoard();
  renderKeyboard();
}

function finishWin() {
  state.isComplete = true;
  setStatus(`Solved in ${state.guesses.length}/6`, 'success-badge');
}

function finishLoss(revealed = false) {
  state.isComplete = true;
  setStatus(revealed ? `Answer: ${state.answer}` : `Out of guesses. Answer: ${state.answer}`, 'danger-badge');
}

function submitGuess() {
  if (state.isComplete) return;
  if (state.currentGuess.length !== WORD_LENGTH) {
    setStatus('Guess must be 5 letters.');
    return;
  }

  const word = state.currentGuess.toUpperCase();

  if (!state.allowedWords.has(word.toLowerCase())) {
    setStatus('Not in word list.', 'danger-badge');
    return;
  }

  const score = scoreGuess(word, state.answer);
  state.guesses.push({ word, score });
  state.currentGuess = '';

  word.split('').forEach((letter, index) => {
    state.statuses[letter] = mergeKeyStatus(state.statuses[letter], score[index]);
  });

  renderAll();

  if (word === state.answer) {
    finishWin();
    return;
  }

  if (state.guesses.length >= MAX_ROWS) {
    finishLoss();
    return;
  }

  setStatus(`Keep going — ${MAX_ROWS - state.guesses.length} guess${MAX_ROWS - state.guesses.length === 1 ? '' : 'es'} left.`);
}

function handleKey(rawKey) {
  const key = rawKey === 'Backspace' ? '⌫' : rawKey.toUpperCase();

  if (state.isComplete && key !== 'ENTER') return;

  if (key === 'ENTER') {
    if (state.isComplete) {
      startNewGame();
      return;
    }
    submitGuess();
    return;
  }

  if (key === '⌫') {
    if (state.isComplete) return;
    state.currentGuess = state.currentGuess.slice(0, -1);
    renderBoard();
    return;
  }

  if (!/^[A-Z]$/.test(key) || state.currentGuess.length >= WORD_LENGTH || state.isComplete) return;
  state.currentGuess += key;
  renderBoard();
}

function startNewGame() {
  const picked = chooseRandomAnswer();
  if (!picked) {
    setStatus('No answers available.');
    return;
  }

  state.answer = picked.answer;
  state.answerMeta = picked;
  state.guesses = [];
  state.currentGuess = '';
  state.statuses = {};
  state.isComplete = false;

  setStatus('New practice game ready.');
  renderAll();
}

function revealAnswer() {
  if (!state.answer) return;
  finishLoss(true);
}

window.addEventListener('keydown', (event) => {
  const key = event.key;
  if (key === 'Enter') {
    event.preventDefault();
    handleKey('ENTER');
    return;
  }
  if (key === 'Backspace') {
    handleKey('⌫');
    return;
  }
  if (/^[a-zA-Z]$/.test(key)) {
    handleKey(key.toUpperCase());
  }
});

el.newGame?.addEventListener('click', startNewGame);
el.reveal?.addEventListener('click', revealAnswer);

async function init() {
  try {
    const [answers, allowedWords] = await Promise.all([
      fetchAllAnswers(),
      fetchAllowedWords(),
    ]);
    state.allAnswers = answers;
    state.allowedWords = new Set(allowedWords);
    setStatus(`${state.allAnswers.length} practice answers loaded.`);
    el.meta.textContent = `Answer archive and ${state.allowedWords.size.toLocaleString()} allowed guesses are cached in your browser for 12 hours.`;
    startNewGame();
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'Could not load practice data.', 'danger-badge');
    el.meta.textContent = 'Practice mode could not load the answer archive or allowed word list.';
  }
}

init();
