import { supabase } from './supabase-client.js';

const wrap = document.getElementById('leaderboard-table-wrap');
const summaryWrap = document.getElementById('leaderboard-summary');
const buttons = [...document.querySelectorAll('.filter-btn')];

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function aggregateSolvedRows(rows) {
  const byUser = new Map();
  for (const row of rows) {
    if (!row.solved || !Number.isFinite(row.score)) continue;
    const current = byUser.get(row.user_id) || {
      user_id: row.user_id,
      display_name: row.display_name || 'Unknown',
      games: 0,
      totalScore: 0,
      best: null,
      lastPlayedAt: null,
    };
    current.games += 1;
    current.totalScore += row.score;
    current.best = current.best == null ? row.score : Math.min(current.best, row.score);
    current.lastPlayedAt = current.lastPlayedAt ? Math.max(Date.parse(current.lastPlayedAt), Date.parse(row.submitted_at)) : Date.parse(row.submitted_at);
    byUser.set(row.user_id, current);
  }

  return [...byUser.values()]
    .map((row) => ({
      ...row,
      average: row.games ? row.totalScore / row.games : null,
    }))
    .sort((a, b) => {
      if ((a.average ?? 99) !== (b.average ?? 99)) return (a.average ?? 99) - (b.average ?? 99);
      if (a.games !== b.games) return b.games - a.games;
      if ((a.best ?? 99) !== (b.best ?? 99)) return (a.best ?? 99) - (b.best ?? 99);
      return a.display_name.localeCompare(b.display_name);
    });
}

function renderSummaryCards(rows, title) {
  const solved = rows.filter((row) => row.solved && Number.isFinite(row.score));
  const leaderboard = aggregateSolvedRows(rows);
  const leader = leaderboard[0];
  const avg = solved.length ? (solved.reduce((sum, row) => sum + row.score, 0) / solved.length).toFixed(2) : '—';

  summaryWrap.innerHTML = `
    <article class="summary-card highlight-card">
      <span class="summary-label">View</span>
      <strong>${escapeHtml(title)}</strong>
      <p class="muted">${rows.length} submission${rows.length === 1 ? '' : 's'}</p>
    </article>
    <article class="summary-card">
      <span class="summary-label">Leader</span>
      <strong>${leader ? escapeHtml(leader.display_name) : '—'}</strong>
      <p class="muted">${leader ? `${leader.average.toFixed(2)} avg` : 'No solves yet.'}</p>
    </article>
    <article class="summary-card">
      <span class="summary-label">Solved games</span>
      <strong>${solved.length}</strong>
      <p class="muted">Average score ${avg}</p>
    </article>
    <article class="summary-card">
      <span class="summary-label">Top best</span>
      <strong>${leader?.best ? `${leader.best}/6` : '—'}</strong>
      <p class="muted">Best single winning score in this view</p>
    </article>
  `;
}

function renderDailyWinner(rows) {
  const latestPuzzle = Math.max(...rows.map((row) => row.puzzle_number));
  const dailyRows = rows
    .filter((row) => row.puzzle_number === latestPuzzle)
    .sort((a, b) => {
      if (a.solved !== b.solved) return a.solved ? -1 : 1;
      if ((a.score ?? 99) !== (b.score ?? 99)) return (a.score ?? 99) - (b.score ?? 99);
      return Date.parse(a.submitted_at) - Date.parse(b.submitted_at);
    });

  const winner = dailyRows.find((row) => row.solved) || null;
  renderSummaryCards(dailyRows, `Puzzle #${latestPuzzle}`);

  if (!dailyRows.length) {
    wrap.textContent = 'No daily data yet.';
    return;
  }

  wrap.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th>Result</th>
            <th>Submitted</th>
          </tr>
        </thead>
        <tbody>
          ${dailyRows.map((row, index) => `
            <tr>
              <td><span class="rank-badge">${index + 1}</span></td>
              <td>${index === 0 && row.solved ? '👑 ' : ''}${escapeHtml(row.display_name)}</td>
              <td>${row.solved ? `${row.score}/6` : 'X/6'}</td>
              <td>${new Date(row.submitted_at).toLocaleString()}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ${winner ? `<div class="winner-banner">Winner for puzzle #${latestPuzzle}: <strong>${escapeHtml(winner.display_name)}</strong> with ${winner.score}/6.</div>` : '<div class="winner-banner">Nobody has solved the latest puzzle yet.</div>'}
  `;
}

async function loadLeaderboard(range = '7') {
  wrap.textContent = 'Loading leaderboard…';
  summaryWrap.innerHTML = '';

  const { data, error } = await supabase
    .from('submission_feed')
    .select('*')
    .order('submitted_at', { ascending: false });

  if (error) {
    wrap.textContent = error.message;
    return;
  }

  const allRows = data || [];

  if (range === 'daily') {
    if (!allRows.length) {
      wrap.textContent = 'No leaderboard data yet.';
      return;
    }
    renderDailyWinner(allRows);
    return;
  }

  let filteredRows = allRows;
  let title = 'All time';
  if (range !== 'all') {
    const days = Number(range);
    const since = new Date();
    since.setDate(since.getDate() - days);
    filteredRows = allRows.filter((row) => Date.parse(row.submitted_at) >= since.getTime());
    title = days === 7 ? 'Weekly' : 'Monthly';
  }

  const leaderboard = aggregateSolvedRows(filteredRows);
  renderSummaryCards(filteredRows, title);

  if (!leaderboard.length) {
    wrap.textContent = 'No leaderboard data yet.';
    return;
  }

  wrap.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th>Games solved</th>
            <th>Average</th>
            <th>Best</th>
          </tr>
        </thead>
        <tbody>
          ${leaderboard.map((row, index) => `
            <tr>
              <td><span class="rank-badge">${index + 1}</span></td>
              <td>${index === 0 ? '👑 ' : ''}${escapeHtml(row.display_name)}</td>
              <td>${row.games}</td>
              <td>${row.average.toFixed(2)}</td>
              <td>${row.best}/6</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

buttons.forEach((button) => {
  button.addEventListener('click', () => {
    buttons.forEach((btn) => btn.classList.remove('active'));
    button.classList.add('active');
    loadLeaderboard(button.dataset.range);
  });
});

loadLeaderboard('7');
