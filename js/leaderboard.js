import { supabase } from './supabase-client.js';

const CHICAGO_TZ = 'America/Chicago';
const DEFAULT_AVATAR = './assets/default-avatar.svg';
const wrap = document.getElementById('leaderboard-table-wrap');
const summaryWrap = document.getElementById('leaderboard-summary');
const buttons = [...document.querySelectorAll('.filter-btn')];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getChicagoDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHICAGO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });

  const parts = formatter.formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    weekdayShort: map.weekday,
    isoDate: `${map.year}-${map.month}-${map.day}`,
  };
}

function chicagoDateStringFromParts(year, month, day) {
  return `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDaysToIsoDate(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return chicagoDateStringFromParts(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}

function getChicagoWeekRange(date = new Date()) {
  const parts = getChicagoDateParts(date);
  const order = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const start = addDaysToIsoDate(parts.isoDate, -order[parts.weekdayShort]);
  const endExclusive = addDaysToIsoDate(start, 7);
  return { start, endExclusive };
}

function getChicagoMonthRange(date = new Date()) {
  const parts = getChicagoDateParts(date);
  const start = chicagoDateStringFromParts(parts.year, parts.month, 1);
  const nextMonthYear = parts.month === 12 ? parts.year + 1 : parts.year;
  const nextMonth = parts.month === 12 ? 1 : parts.month + 1;
  const endExclusive = chicagoDateStringFromParts(nextMonthYear, nextMonth, 1);
  return { start, endExclusive };
}

function getChicagoIsoDateFromTimestamp(timestamp) {
  const parts = getChicagoDateParts(new Date(timestamp));
  return chicagoDateStringFromParts(parts.year, parts.month, parts.day);
}

function formatChicagoDateLabel(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatChicagoMonthLabel(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TZ,
    month: 'long',
    year: 'numeric',
  }).format(date);
}

async function getAvatarUrlMap(rows) {
  const uniquePaths = [...new Set((rows || []).map((row) => row.avatar_url).filter(Boolean))];
  const map = new Map();

  await Promise.all(uniquePaths.map(async (path) => {
    const { data, error } = await supabase.storage.from('avatars').createSignedUrl(path, 60 * 60);
    map.set(path, error ? DEFAULT_AVATAR : (data?.signedUrl || DEFAULT_AVATAR));
  }));

  return map;
}

function aggregateSolvedRows(rows) {
  const byUser = new Map();
  for (const row of rows) {
    if (!row.solved || !Number.isFinite(row.score)) continue;
    const current = byUser.get(row.user_id) || {
      user_id: row.user_id,
      display_name: row.display_name || 'Unknown',
      avatar_url: row.avatar_url || null,
      catchphrase: row.catchphrase || '',
      games: 0,
      totalScore: 0,
      best: null,
      lastPlayedAt: null,
    };
    current.games += 1;
    current.totalScore += row.score;
    current.best = current.best == null ? row.score : Math.min(current.best, row.score);
    current.lastPlayedAt = current.lastPlayedAt ? Math.max(Date.parse(current.lastPlayedAt), Date.parse(row.submitted_at)) : Date.parse(row.submitted_at);
    if (!current.avatar_url && row.avatar_url) current.avatar_url = row.avatar_url;
    if (!current.catchphrase && row.catchphrase) current.catchphrase = row.catchphrase;
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

function renderPlayerCell(row, avatarSrc, withCrown = false) {
  return `
    <div class="table-player">
      <img class="leaderboard-avatar" src="${avatarSrc}" alt="${escapeHtml(row.display_name)} profile picture">
      <div class="table-player-text">
        <span class="name">${withCrown ? '👑 ' : ''}${escapeHtml(row.display_name)}</span>
        ${row.catchphrase ? `<span class="tag">“${escapeHtml(row.catchphrase)}”</span>` : ''}
      </div>
    </div>
  `;
}

async function renderDailyWinner(rows) {
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

  const avatarMap = await getAvatarUrlMap(dailyRows);

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
              <td>${renderPlayerCell(row, avatarMap.get(row.avatar_url) || DEFAULT_AVATAR, index === 0 && row.solved)}</td>
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

async function loadLeaderboard(range = 'week') {
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
    await renderDailyWinner(allRows);
    return;
  }

  let filteredRows = allRows;
  let title = 'All time';

  if (range === 'week') {
    const weekRange = getChicagoWeekRange();
    filteredRows = allRows.filter((row) => {
      const chicagoDate = getChicagoIsoDateFromTimestamp(row.submitted_at);
      return chicagoDate >= weekRange.start && chicagoDate < weekRange.endExclusive;
    });
    title = `Week of ${formatChicagoDateLabel(weekRange.start)} – ${formatChicagoDateLabel(addDaysToIsoDate(weekRange.endExclusive, -1))} · Chicago`;
  }

  if (range === 'month') {
    const monthRange = getChicagoMonthRange();
    filteredRows = allRows.filter((row) => {
      const chicagoDate = getChicagoIsoDateFromTimestamp(row.submitted_at);
      return chicagoDate >= monthRange.start && chicagoDate < monthRange.endExclusive;
    });
    title = `${formatChicagoMonthLabel()} · Chicago`;
  }

  const leaderboard = aggregateSolvedRows(filteredRows);
  renderSummaryCards(filteredRows, title);

  if (!leaderboard.length) {
    wrap.textContent = 'No leaderboard data yet.';
    return;
  }

  const avatarMap = await getAvatarUrlMap(leaderboard);

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
              <td>${renderPlayerCell(row, avatarMap.get(row.avatar_url) || DEFAULT_AVATAR, index === 0)}</td>
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

loadLeaderboard('week');
