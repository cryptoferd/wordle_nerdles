import { supabase } from './supabase-client.js';

const CHICAGO_TZ = 'America/Chicago';
const DEFAULT_AVATAR = './assets/default-avatar.svg';
const WORDLE_ANCHOR_PUZZLE = 1758;
const WORDLE_ANCHOR_DATE = '2026-04-12';
const wrap = document.getElementById('leaderboard-table-wrap');
const summaryWrap = document.getElementById('leaderboard-summary');
const buttons = [...document.querySelectorAll('.filter-btn')];
const periodNav = document.getElementById('period-nav');
const periodNavLabel = document.getElementById('period-nav-label');
const periodPrevBtn = document.getElementById('period-prev-btn');
const periodCurrentBtn = document.getElementById('period-current-btn');
const periodNextBtn = document.getElementById('period-next-btn');

const state = {
  range: 'week',
  periodOffset: 0, // 0 = current period, 1 = previous period, 2 = two periods back
};

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

function getChicagoWeekRange(date = new Date(), offset = 0) {
  const parts = getChicagoDateParts(date);
  const order = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const currentStart = addDaysToIsoDate(parts.isoDate, -order[parts.weekdayShort]);
  const start = addDaysToIsoDate(currentStart, -(offset * 7));
  const endExclusive = addDaysToIsoDate(start, 7);
  return { start, endExclusive };
}

function getChicagoMonthRange(date = new Date(), offset = 0) {
  const parts = getChicagoDateParts(date);
  const totalMonths = (parts.year * 12 + (parts.month - 1)) - offset;
  const year = Math.floor(totalMonths / 12);
  const month = (totalMonths % 12) + 1;
  const start = chicagoDateStringFromParts(year, month, 1);
  const nextTotalMonths = totalMonths + 1;
  const nextYear = Math.floor(nextTotalMonths / 12);
  const nextMonth = (nextTotalMonths % 12) + 1;
  const endExclusive = chicagoDateStringFromParts(nextYear, nextMonth, 1);
  return { start, endExclusive, year, month };
}

function getChicagoIsoDateFromTimestamp(timestamp) {
  const parts = getChicagoDateParts(new Date(timestamp));
  return chicagoDateStringFromParts(parts.year, parts.month, parts.day);
}

function getChicagoIsoDateFromPuzzleNumber(puzzleNumber) {
  if (!Number.isFinite(Number(puzzleNumber))) return null;
  const offset = Number(puzzleNumber) - WORDLE_ANCHOR_PUZZLE;
  return addDaysToIsoDate(WORDLE_ANCHOR_DATE, offset);
}

function formatChicagoDateLabel(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatChicagoMonthLabelFromParts(year, month) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function getUniquePuzzleCount(rows) {
  return new Set((rows || []).map((row) => row.puzzle_number)).size;
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
      if (a.games !== b.games) return b.games - a.games;
      if ((a.average ?? 99) !== (b.average ?? 99)) return (a.average ?? 99) - (b.average ?? 99);
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
    <a class="profile-link" href="profile.html?user=${encodeURIComponent(row.user_id)}">
      <div class="table-player">
        <img class="leaderboard-avatar" src="${avatarSrc}" alt="${escapeHtml(row.display_name)} profile picture">
        <div class="table-player-text">
          <span class="name">${withCrown ? '👑 ' : ''}${escapeHtml(row.display_name)}</span>
          ${row.catchphrase ? `<span class="tag">“${escapeHtml(row.catchphrase)}”</span>` : ''}
        </div>
      </div>
    </a>
  `;
}

async function renderDailyWinner(rows) {
  const latestPuzzle = Math.max(...rows.map((row) => row.puzzle_number));
  const dailyRows = rows
    .filter((row) => row.puzzle_number === latestPuzzle)
    .sort((a, b) => {
      if (a.solved !== b.solved) return a.solved ? -1 : 1;
      if ((a.score ?? 99) !== (b.score ?? 99)) return (a.score ?? 99) - (b.score ?? 99);
      return (a.display_name || '').localeCompare(b.display_name || '');
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

function updatePeriodNav() {
  const periodMode = state.range === 'week' || state.range === 'month';

  if (periodNav) {
    periodNav.classList.toggle('hidden', !periodMode);
  }

  if (!periodMode) return;

  if (periodNavLabel) {
    if (state.range === 'week') {
      periodNavLabel.textContent = state.periodOffset === 0
        ? 'Viewing current week'
        : `Viewing ${state.periodOffset} week${state.periodOffset === 1 ? '' : 's'} ago`;
    } else {
      periodNavLabel.textContent = state.periodOffset === 0
        ? 'Viewing current month'
        : `Viewing ${state.periodOffset} month${state.periodOffset === 1 ? '' : 's'} ago`;
    }
  }

  if (periodNextBtn) periodNextBtn.disabled = state.periodOffset === 0;
}

async function loadLeaderboard() {
  wrap.textContent = 'Loading leaderboard…';
  summaryWrap.innerHTML = '';
  updatePeriodNav();

  const { data, error } = await supabase
    .from('submission_feed')
    .select('*')
    .order('submitted_at', { ascending: false });

  if (error) {
    wrap.textContent = error.message;
    return;
  }

  const allRows = data || [];

  if (state.range === 'daily') {
    if (!allRows.length) {
      wrap.textContent = 'No leaderboard data yet.';
      return;
    }
    await renderDailyWinner(allRows);
    return;
  }

  let filteredRows = allRows;
  let title = 'All time';

  if (state.range === 'week') {
    const weekRange = getChicagoWeekRange(new Date(), state.periodOffset);
    filteredRows = allRows.filter((row) => {
      const chicagoDate = getChicagoIsoDateFromPuzzleNumber(row.puzzle_number);
      return chicagoDate && chicagoDate >= weekRange.start && chicagoDate < weekRange.endExclusive;
    });
    title = `Week of ${formatChicagoDateLabel(weekRange.start)} – ${formatChicagoDateLabel(addDaysToIsoDate(weekRange.endExclusive, -1))} · Chicago`;
  }

  if (state.range === 'month') {
    const monthRange = getChicagoMonthRange(new Date(), state.periodOffset);
    filteredRows = allRows.filter((row) => {
      const chicagoDate = getChicagoIsoDateFromPuzzleNumber(row.puzzle_number);
      return chicagoDate && chicagoDate >= monthRange.start && chicagoDate < monthRange.endExclusive;
    });
    title = `${formatChicagoMonthLabelFromParts(monthRange.year, monthRange.month)} · Chicago`;
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
    state.range = button.dataset.range;
    if (state.range !== 'week' && state.range !== 'month') {
      state.periodOffset = 0;
    }
    loadLeaderboard();
  });
});

periodPrevBtn?.addEventListener('click', () => {
  if (state.range !== 'week' && state.range !== 'month') return;
  state.periodOffset += 1;
  loadLeaderboard();
});

periodCurrentBtn?.addEventListener('click', () => {
  if (state.range !== 'week' && state.range !== 'month') return;
  state.periodOffset = 0;
  loadLeaderboard();
});

periodNextBtn?.addEventListener('click', () => {
  if ((state.range !== 'week' && state.range !== 'month') || state.periodOffset === 0) return;
  state.periodOffset -= 1;
  loadLeaderboard();
});

loadLeaderboard();
