const API_BASE = 'https://wordlehints.co.uk/wp-json/wordlehint/v1/answers';

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
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function loadAnswers() {
  const params = new URLSearchParams({
    page: String(state.page),
    per_page: String(state.perPage),
    order: state.order,
  });

  if (state.answer) params.set('answer', state.answer);

  el.meta.textContent = 'Loading…';
  el.list.innerHTML = '';

  try {
    const response = await fetch(`${API_BASE}?${params.toString()}`);
    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const data = await response.json();
    const results = data.results || [];
    state.hasMore = Boolean(data.has_more);

    el.meta.textContent = `Showing ${results.length} of ${data.total ?? 'unknown'} total results`;
    el.pageLabel.textContent = `Page ${data.page ?? state.page}`;

    if (!results.length) {
      el.list.innerHTML = `<p>No past answers found.</p>`;
      return;
    }

    el.list.innerHTML = `
      <div class="answers-grid">
        ${results.map(item => `
          <article class="answer-card">
            <div class="answer-top">
              <strong>#${item.game}</strong>
              <span>${escapeHtml(item.day_name || '')}</span>
            </div>
            <div class="answer-word">${escapeHtml(item.answer)}</div>
            <div class="answer-meta">
              <span>${escapeHtml(item.date)}</span>
              <span>Difficulty: ${item.difficulty ?? '—'}</span>
            </div>
          </article>
        `).join('')}
      </div>
    `;

    el.prevPage.disabled = state.page <= 1;
    el.nextPage.disabled = !state.hasMore;
  } catch (error) {
    console.error(error);
    el.meta.textContent = error.message || 'Could not load past answers.';
  }
}

el.order.addEventListener('change', () => {
  state.order = el.order.value;
  state.page = 1;
  loadAnswers();
});

el.searchBtn.addEventListener('click', () => {
  state.answer = el.search.value.trim();
  state.page = 1;
  loadAnswers();
});

el.prevPage.addEventListener('click', () => {
  if (state.page <= 1) return;
  state.page -= 1;
  loadAnswers();
});

el.nextPage.addEventListener('click', () => {
  if (!state.hasMore) return;
  state.page += 1;
  loadAnswers();
});

loadAnswers();
