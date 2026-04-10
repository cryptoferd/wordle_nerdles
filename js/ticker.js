import { supabase } from './supabase-client.js';

const CHICAGO_TZ = 'America/Chicago';
const trackEl = document.getElementById('weekly-ticker-track');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function chicagoDateStringFromParts(year, month, day) {
  return `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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

function addDaysToIsoDate(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return chicagoDateStringFromParts(
    utc.getUTCFullYear(),
    utc.getUTCMonth() + 1,
    utc.getUTCDate()
  );
}

function getChicagoWeekRange(date = new Date()) {
  const parts = getChicagoDateParts(date);
  const order = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const start = addDaysToIsoDate(parts.isoDate, -(order[parts.weekdayShort] ?? 0));
  const endExclusive = addDaysToIsoDate(start, 7);
  return { start, endExclusive };
}

function getChicagoIsoDateFromTimestamp(timestamp) {
  const parts = getChicagoDateParts(new Date(timestamp));
  return chicagoDateStringFromParts(parts.year, parts.month, parts.day);
}

function getUniquePuzzleCount(rows) {
  return new Set((rows || []).map((row) => row.puzzle_number)).size;
}

function summarizeLeaderboard(rows) {
  const solvedRows = (rows || []).filter((row) => row.solved && Number.isFinite(row.score));
  const requiredPuzzleCount = getUniquePuzzleCount(rows);
  if (!solvedRows.length || !requiredPuzzleCount) return null;

  const byUser = new Map();

  for (const row of solvedRows) {
    const current = byUser.get(row.user_id) || {
      user_id: row.user_id,
      display_name: row.display_name || 'Unknown',
      games: 0,
      totalScore: 0,
      best: null,
    };

    current.games += 1;
    current.totalScore += row.score;
    current.best = current.best == null ? row.score : Math.min(current.best, row.score);
    byUser.set(row.user_id, current);
  }

  const leaderboard = [...byUser.values()]
    .filter((row) => row.games >= requiredPuzzleCount)
    .map((row) => ({
      ...row,
      average: row.totalScore / row.games,
    }))
    .sort((a, b) => {
      if (a.average !== b.average) return a.average - b.average;
      if (a.games !== b.games) return b.games - a.games;
      if (a.best !== b.best) return a.best - b.best;
      return a.display_name.localeCompare(b.display_name);
    });

  return leaderboard.length ? { leaderboard, leader: leaderboard[0], requiredPuzzleCount } : null;
}

function summarizeTopPlayers(rows) {
  return summarizeLeaderboard(rows)?.leaderboard.slice(0, 3) || [];
}

function renderWeeklyTicker(currentTop3, previousWinner, requiredPuzzleCount) {
  if (!trackEl) return;

  const parts = [];

  if (currentTop3[0]) {
    parts.push(`
      <a class="ticker-link" href="profile.html?user=${encodeURIComponent(currentTop3[0].user_id)}">
        <span class="ticker-item"><span>🥇</span><span class="muted-label">#1:</span><span>${escapeHtml(currentTop3[0].display_name)}</span><span>(${currentTop3[0].average.toFixed(2)})</span></span>
      </a>
    `);
  }
  if (currentTop3[1]) {
    parts.push(`
      <a class="ticker-link" href="profile.html?user=${encodeURIComponent(currentTop3[1].user_id)}">
        <span class="ticker-item"><span>🥈</span><span class="muted-label">#2:</span><span>${escapeHtml(currentTop3[1].display_name)}</span><span>(${currentTop3[1].average.toFixed(2)})</span></span>
      </a>
    `);
  }
  if (currentTop3[2]) {
    parts.push(`
      <a class="ticker-link" href="profile.html?user=${encodeURIComponent(currentTop3[2].user_id)}">
        <span class="ticker-item"><span>🥉</span><span class="muted-label">#3:</span><span>${escapeHtml(currentTop3[2].display_name)}</span><span>(${currentTop3[2].average.toFixed(2)})</span></span>
      </a>
    `);
  }
  if (previousWinner) {
    parts.push(`
      <a class="ticker-link" href="profile.html?user=${encodeURIComponent(previousWinner.user_id)}">
        <span class="ticker-item"><span>🏆</span><span class="muted-label">Last week's Champ:</span><span>${escapeHtml(previousWinner.display_name)}</span><span>(${previousWinner.average.toFixed(2)})</span></span>
      </a>
    `);
  }

  if (!parts.length) {
    trackEl.innerHTML = `<span class="ticker-item">Need ${requiredPuzzleCount || 0} completed weekly plays before standings appear.</span>`;
    return;
  }

  trackEl.innerHTML = [...parts, ...parts, ...parts].join('');
}

async function loadWeeklyTicker() {
  if (!trackEl) return;

  const { data, error } = await supabase
    .from('submission_feed')
    .select('user_id, puzzle_number, display_name, score, solved, submitted_at');

  if (error) {
    console.error(error);
    trackEl.innerHTML = `<span class="ticker-item">Could not load weekly standings.</span>`;
    return;
  }

  const rows = data || [];
  const weekRange = getChicagoWeekRange();
  const previousWeekStart = addDaysToIsoDate(weekRange.start, -7);
  const previousWeekEndExclusive = weekRange.start;

  const weeklyRows = rows.filter((row) => {
    const chicagoDate = getChicagoIsoDateFromTimestamp(row.submitted_at);
    return chicagoDate >= weekRange.start && chicagoDate < weekRange.endExclusive;
  });

  const previousWeeklyRows = rows.filter((row) => {
    const chicagoDate = getChicagoIsoDateFromTimestamp(row.submitted_at);
    return chicagoDate >= previousWeekStart && chicagoDate < previousWeekEndExclusive;
  });

  renderWeeklyTicker(
    summarizeTopPlayers(weeklyRows),
    summarizeLeaderboard(previousWeeklyRows)?.leader || null,
    getUniquePuzzleCount(weeklyRows)
  );
}

loadWeeklyTicker();
