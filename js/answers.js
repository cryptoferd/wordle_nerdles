const API_BASE = 'https://wordlehints.co.uk/wp-json/wordlehint/v1/answers';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_PREFIX = 'wordleAnswersCache:';

const state = {
  page: 1,
  perPage: 50,
  order: 'desc',
  answer: '',
  hasMore: false,
};

const el = {
  list: document.getElementById('answers-list'),
  meta: document.getElementById('answers-meta'),
  pageLabel: document.getElementById('page-label'),
  prevPage: document.getElementById('prev-page'),
  nextPage: document.getElementById('next-page'),
  order: document.getElementById('answer-order'),
  search: document.getElementById('answer-search'),
  searchBtn: document.getElementById('answer-search-btn'),
  refreshBtn: document.getElementById('answer-refresh-btn'),
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getQueryUrl() {
  const params = new URLSearchParams({
    page: String(state.page),
    per_page: String(state.perPage),
    order: state.order,
  });

  if (state.answer) params.set('answer', state.answer);
  return `${API_BASE}?${params.toString()}`;
}

function getCacheKey(url) {
  return `${CACHE_PREFIX}${url}`;
}

function readCache(url) {
  try {
    const raw = localStorage.getItem(getCacheKey(url));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (Date.now() - parsed.cachedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(url, data) {
  try {
    localStorage.setItem(getCacheKey(url), JSON.stringify({
      cachedAt: Date.now(),
      data,
    }));
  } catch {
    // Ignore storage quota issues.
  }
}

function clearCurrentCache() {
  try {
    localStorage.removeItem(getCacheKey(getQueryUrl()));
  } catch {
    // Ignore storage issues.
  }
}

function renderResults(data, source = 'live') {
  const results = data.results || [];
  state.hasMore = Boolean(data.has_more);

  const sourceLabel = source === 'cache' ? 'Loaded from cache.' : 'Loaded from API.';
  el.meta.textContent = `Showing ${results.length} of ${data.total ?? 'unknown'} total results. ${sourceLabel}`;
  el.pageLabel.textContent = `Page ${data.page ?? state.page}`;

  if (!results.length) {
    el.list.innerHTML = `<p>No past answers found.</p>`;
    el.prevPage.disabled = state.page <= 1;
    el.nextPage.disabled = !state.hasMore;
    return;
  }

  el.list.innerHTML = `
    <div class="answers-grid">
      ${results.map((item) => `
        <article class="answer-card">
          <div class="answer-top">
            <strong>#${escapeHtml(item.game ?? '—')}</strong>
            <span>${escapeHtml(item.day_name || '')}</span>
          </div>
          <div class="answer-word">${escapeHtml(item.answer || '')}</div>
          <div class="answer-meta answer-meta-stack">
            <span>${escapeHtml(item.date || '')}</span>
            <span>Difficulty: ${escapeHtml(item.difficulty ?? '—')}</span>
          </div>
        </article>
      `).join('')}
    </div>
  `;

  el.prevPage.disabled = state.page <= 1;
  el.nextPage.disabled = !state.hasMore;
}

async function loadAnswers({ forceRefresh = false } = {}) {
  const url = getQueryUrl();
  el.meta.textContent = 'Loading…';
  el.list.innerHTML = '';

  const cached = !forceRefresh ? readCache(url) : null;
  if (cached?.data) {
    renderResults(cached.data, 'cache');
    return;
  }

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const data = await response.json();
    writeCache(url, data);
    renderResults(data, 'live');
  } catch (error) {
    console.error(error);
    el.meta.textContent = error.message || 'Could not load past answers.';
  }
}

el.order?.addEventListener('change', () => {
  state.order = el.order.value;
  state.page = 1;
  loadAnswers();
});

el.searchBtn?.addEventListener('click', () => {
  state.answer = el.search.value.trim();
  state.page = 1;
  loadAnswers();
});

el.search?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    state.answer = el.search.value.trim();
    state.page = 1;
    loadAnswers();
  }
});

el.refreshBtn?.addEventListener('click', () => {
  clearCurrentCache();
  loadAnswers({ forceRefresh: true });
});

el.prevPage?.addEventListener('click', () => {
  if (state.page <= 1) return;
  state.page -= 1;
  loadAnswers();
});

el.nextPage?.addEventListener('click', () => {
  if (!state.hasMore) return;
  state.page += 1;
  loadAnswers();
});

loadAnswers();
