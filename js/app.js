import { supabase } from './supabase-client.js';
import { parseWordleShare, renderMiniGrid } from './parser.js';
import { getSession, signIn, signOut, signUp, sendMagicLink, ensureProfile } from './auth.js';
import { mountComments, attachScreenshotToSubmission, getSignedScreenshotUrl } from './comments.js';

const CHICAGO_TZ = 'America/Chicago';
const PLAY_WORDLE_URL = 'https://www.nytimes.com/games/wordle/index.html';
const DEFAULT_AVATAR = './assets/default-avatar.svg';
const WORDLE_ANCHOR_PUZZLE = 1758;
const WORDLE_ANCHOR_DATE = '2026-04-12';


function getChicagoNowParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    isoDate: `${map.year}-${map.month}-${map.day}`,
  };
}

function daysBetweenIsoDates(startIso, endIso) {
  const [sy, sm, sd] = startIso.split('-').map(Number);
  const [ey, em, ed] = endIso.split('-').map(Number);

  const start = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);

  return Math.round((end - start) / 86400000);
}

function getCurrentChicagoPuzzleNumber(now = new Date()) {
  const chicagoToday = getChicagoNowParts(now).isoDate;
  const offset = daysBetweenIsoDates(WORDLE_ANCHOR_DATE, chicagoToday);
  return WORDLE_ANCHOR_PUZZLE + offset;
}

const state = {
  session: null,
  currentPuzzle: null,
};

const el = {
  authStatus: document.getElementById('auth-status'),
  authForm: document.getElementById('auth-form'),
  displayName: document.getElementById('display-name'),
  email: document.getElementById('email'),
  password: document.getElementById('password'),
  signInBtn: document.getElementById('sign-in-btn'),
  magicLinkBtn: document.getElementById('magic-link-btn'),
  signOutBtn: document.getElementById('sign-out-btn'),
  submissionForm: document.getElementById('submission-form'),
  shareText: document.getElementById('share-text'),
  screenshot: document.getElementById('screenshot'),
  previewBtn: document.getElementById('preview-btn'),
  parsePreview: document.getElementById('parse-preview'),
  todayStandings: document.getElementById('today-standings'),
  todayPuzzleLabel: document.getElementById('today-puzzle-label'),
  todayPlayerCount: document.getElementById('today-player-count'),
  todayAverage: document.getElementById('today-average'),
  todaySolveRate: document.getElementById('today-solve-rate'),
  dailyWinnerName: document.getElementById('daily-winner-name'),
  dailyWinnerDetail: document.getElementById('daily-winner-detail'),
  weeklyLeaderName: document.getElementById('weekly-leader-name'),
  weeklyLeaderDetail: document.getElementById('weekly-leader-detail'),
  monthlyLeaderName: document.getElementById('monthly-leader-name'),
  monthlyLeaderDetail: document.getElementById('monthly-leader-detail'),
  alltimeLeaderName: document.getElementById('alltime-leader-name'),
  alltimeLeaderDetail: document.getElementById('alltime-leader-detail'),
  weeklyRangeLabel: document.getElementById('weekly-range-label'),
  monthlyRangeLabel: document.getElementById('monthly-range-label'),
  weeklyTickerTrack: document.getElementById('weekly-ticker-track'),
  playTodayBtn: document.getElementById('play-today-btn'),
  toast: document.getElementById('toast'),
};

function showToast(message) {
  if (!el.toast) return;
  el.toast.textContent = message;
  el.toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.toast.classList.add('hidden'), 3000);
}

function setAuthUi(session) {
  if (session?.user) {
    el.authStatus.textContent = `Signed in as ${session.user.email}`;
    el.signOutBtn?.classList.remove('hidden');
  } else {
    el.authStatus.textContent = 'Not signed in.';
    el.signOutBtn?.classList.add('hidden');
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function previewParse() {
  const parsed = parseWordleShare(el.shareText.value);

  el.parsePreview.innerHTML = `
    <strong>Puzzle ${parsed.puzzleNumber}</strong><br>
    Score: ${parsed.solved ? `${parsed.score}/6` : 'X/6'}<br>
    <div class="mini-grid">${renderMiniGrid(parsed.rows)}</div>
  `;

  return parsed;
}

async function uploadScreenshot(userId, puzzleNumber, file) {
  if (!file) return null;

  const extension = file.name.split('.').pop()?.toLowerCase() || 'png';
  const path = `${userId}/${puzzleNumber}-${Date.now()}.${extension}`;

  const { error } = await supabase.storage
    .from('screenshots')
    .upload(path, file, { upsert: false });

  if (error) throw error;
  return path;
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

function getChicagoWeekdayIndex(weekdayShort) {
  const order = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  return order[weekdayShort];
}

function chicagoDateStringFromParts(year, month, day) {
  const y = String(year);
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
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
  const weekdayIndex = getChicagoWeekdayIndex(parts.weekdayShort);
  const start = addDaysToIsoDate(parts.isoDate, -weekdayIndex);
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

function formatChicagoDateLabel(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));

  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  }).format(dt);
}

function formatChicagoMonthLabel(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TZ,
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function getChicagoIsoDateFromTimestamp(timestamp) {
  const dt = new Date(timestamp);
  const parts = getChicagoDateParts(dt);
  return chicagoDateStringFromParts(parts.year, parts.month, parts.day);
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


function getUniquePuzzleCount(rows) {
  return new Set((rows || []).map((row) => row.puzzle_number)).size;
}

function summarizeTopPlayers(rows) {
  const solvedRows = (rows || []).filter((row) => row.solved && Number.isFinite(row.score));
  if (!solvedRows.length) return [];

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

  return [...byUser.values()]
    .map((row) => ({
      ...row,
      average: row.totalScore / row.games,
    }))
    .sort((a, b) => {
      if (a.games !== b.games) return b.games - a.games;
      if (a.average !== b.average) return a.average - b.average;
      if (a.best !== b.best) return a.best - b.best;
      return a.display_name.localeCompare(b.display_name);
    });
}

function renderWeeklyTicker(currentTop3, previousWinner, requiredPuzzleCount) {
  if (!el.weeklyTickerTrack) return;

  const parts = [];

  if (currentTop3[0]) {
    parts.push(`
      <a class="ticker-link" href="profile.html?user=${encodeURIComponent(currentTop3[0].user_id)}">
        <span class="ticker-item">
          <span>🥇</span>
          <span class="muted-label">This week:</span>
          <span>${escapeHtml(currentTop3[0].display_name)}</span>
          <span>(${currentTop3[0].average.toFixed(2)})</span>
        </span>
      </a>
    `);
  }

  if (currentTop3[1]) {
    parts.push(`
      <a class="ticker-link" href="profile.html?user=${encodeURIComponent(currentTop3[1].user_id)}">
        <span class="ticker-item">
          <span>🥈</span>
          <span class="muted-label">This week:</span>
          <span>${escapeHtml(currentTop3[1].display_name)}</span>
          <span>(${currentTop3[1].average.toFixed(2)})</span>
        </span>
      </a>
    `);
  }

  if (currentTop3[2]) {
    parts.push(`
      <a class="ticker-link" href="profile.html?user=${encodeURIComponent(currentTop3[2].user_id)}">
        <span class="ticker-item">
          <span>🥉</span>
          <span class="muted-label">This week:</span>
          <span>${escapeHtml(currentTop3[2].display_name)}</span>
          <span>(${currentTop3[2].average.toFixed(2)})</span>
        </span>
      </a>
    `);
  }

  if (previousWinner) {
    parts.push(`
      <a class="ticker-link" href="profile.html?user=${encodeURIComponent(previousWinner.user_id)}">
        <span class="ticker-item">
          <span>🏆</span>
          <span class="muted-label">Last week:</span>
          <span>${escapeHtml(previousWinner.display_name)}</span>
          <span>(${previousWinner.average.toFixed(2)})</span>
        </span>
      </a>
    `);
  }

  if (!parts.length) {
    el.weeklyTickerTrack.innerHTML = `<span class="ticker-item">No weekly standings yet.</span>`;
    return;
  }

  el.weeklyTickerTrack.innerHTML = [...parts, ...parts].join('');
}

function summarizeLeaderboard(rows) {
  const solvedRows = (rows || []).filter((row) => row.solved && Number.isFinite(row.score));
  if (!solvedRows.length) return null;

  const byUser = new Map();

  for (const row of solvedRows) {
    const current = byUser.get(row.user_id) || {
      user_id: row.user_id,
      display_name: row.display_name || 'Unknown',
      games: 0,
      totalScore: 0,
      best: null,
      wins: 0,
    };

    current.games += 1;
    current.totalScore += row.score;
    current.best = current.best == null ? row.score : Math.min(current.best, row.score);

    byUser.set(row.user_id, current);
  }

  const leaderboard = [...byUser.values()]
    .map((row) => ({
      ...row,
      average: row.totalScore / row.games,
    }))
    .sort((a, b) => {
      if (a.games !== b.games) return b.games - a.games;
      if (a.average !== b.average) return a.average - b.average;
      if (a.best !== b.best) return a.best - b.best;
      return a.display_name.localeCompare(b.display_name);
    });

  if (!leaderboard.length) return null;

  return {
    leaderboard,
    leader: leaderboard[0],
  };
}

function renderLeaderCard(nameEl, detailEl, summary, emptyText) {
  if (!nameEl || !detailEl) return;

  if (!summary?.leader) {
    nameEl.textContent = '—';
    detailEl.textContent = emptyText;
    return;
  }

  const leader = summary.leader;
  nameEl.textContent = leader.display_name;
  detailEl.textContent = `${leader.average.toFixed(2)} avg across ${leader.games} solved game${leader.games === 1 ? '' : 's'}`;
}

async function renderTodayStandings(players) {
  if (!el.todayStandings) return;

  const avatarMap = await getAvatarUrlMap(players);
  const cards = await Promise.all(players.map(async (player, index) => {
    const avatarSrc = avatarMap.get(player.avatar_url) || DEFAULT_AVATAR;
    const isOwn = state.session?.user?.id === player.user_id;
    let screenshotHtml = '';

    if (player.screenshot_path) {
      const signedUrl = await getSignedScreenshotUrl(player.screenshot_path);
      screenshotHtml = signedUrl
        ? `<div class="screenshot-card"><img src="${signedUrl}" alt="${escapeHtml(player.display_name || 'Unknown')} screenshot" data-fullsrc="${signedUrl}" /></div>`
        : `<div class="screenshot-locked">Screenshot unavailable.</div>`;
    } else if (isOwn) {
      screenshotHtml = `
        <div class="screenshot-uploader-inline">
          <label class="inline-upload-label">Forgot your screenshot?</label>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif" data-add-screenshot-input="${player.id}">
          <button type="button" class="ghost-btn" data-add-screenshot-btn="${player.id}">Add screenshot</button>
        </div>
      `;
    }

    return `
      <article class="player-card" data-submission-id="${player.id}">
        <div class="player-row">
          <a class="player-link" href="profile.html?user=${encodeURIComponent(player.user_id)}">
            <div class="player-row-top">
              <img class="player-avatar circular" src="${avatarSrc}" alt="${escapeHtml(player.display_name || 'Unknown')} profile picture">
              <div class="player-meta">
                <div class="player-name-line">
                  <strong>${index === 0 && player.solved ? '👑 ' : ''}${escapeHtml(player.display_name || 'Unknown')}</strong>
                </div>
                ${player.catchphrase ? `<div class="catchphrase">“${escapeHtml(player.catchphrase)}”</div>` : ''}
                <span class="muted">${new Date(player.submitted_at).toLocaleString()}</span>
              </div>
            </div>
          </a>
          <div class="score-pill">${player.solved ? `${player.score}/6` : 'X/6'}</div>
        </div>
        ${index === 0 && player.solved ? `<div class="winner-banner">Daily winner — first best solve for puzzle #${player.puzzle_number}</div>` : ''}
        <div class="mini-grid">${renderMiniGrid(player.rows_json || [])}</div>
        ${screenshotHtml}
        <div class="submission-comments" data-comments-host="${player.id}"></div>
      </article>
    `;
  }));

  el.todayStandings.innerHTML = `<div class="standings-list">${cards.join('')}</div>`;

  el.todayStandings.querySelectorAll('img[data-fullsrc]').forEach((img) => {
    img.addEventListener('click', () => {
      window.open(img.dataset.fullsrc, '_blank', 'noopener,noreferrer');
    });
  });

  el.todayStandings.querySelectorAll('[data-add-screenshot-btn]').forEach((button) => {
    button.addEventListener('click', async () => {
      const submissionId = button.dataset.addScreenshotBtn;
      const input = el.todayStandings.querySelector(`[data-add-screenshot-input="${submissionId}"]`);
      const file = input?.files?.[0];
      const submission = players.find((row) => row.id === submissionId);

      if (!submission) return;

      try {
        await attachScreenshotToSubmission(submission, file);
        showToast('Screenshot added.');
        await loadTodayStats(state.currentPuzzle);
      } catch (error) {
        console.error(error);
        showToast(error.message || 'Could not add screenshot.');
      }
    });
  });

  await mountComments({
    container: el.todayStandings,
    submissions: players,
    session: state.session,
    onError: (error) => showToast(error.message || 'Could not load comments.'),
    onSuccess: (message) => showToast(message),
  });
}

async function loadRunningLeaders() {
  const { data, error } = await supabase
    .from('submission_feed')
    .select('user_id, puzzle_number, display_name, avatar_url, catchphrase, score, solved, submitted_at');

  if (error) {
    console.error(error);
    return;
  }

  const rows = data || [];
  const weekRange = getChicagoWeekRange();
  const monthRange = getChicagoMonthRange();

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

  const monthlyRows = rows.filter((row) => {
    const chicagoDate = getChicagoIsoDateFromTimestamp(row.submitted_at);
    return chicagoDate >= monthRange.start && chicagoDate < monthRange.endExclusive;
  });

  if (el.weeklyRangeLabel) {
    const weekEndLabel = formatChicagoDateLabel(addDaysToIsoDate(weekRange.endExclusive, -1));
    el.weeklyRangeLabel.textContent = `${formatChicagoDateLabel(weekRange.start)} – ${weekEndLabel} · Chicago`;
  }

  if (el.monthlyRangeLabel) {
    el.monthlyRangeLabel.textContent = `${formatChicagoMonthLabel()} · Chicago`;
  }

  const weeklySummary = summarizeLeaderboard(weeklyRows);
  const monthlySummary = summarizeLeaderboard(monthlyRows);
  const allTimeSummary = summarizeLeaderboard(rows);
  const previousWeekSummary = summarizeLeaderboard(previousWeeklyRows);

  renderLeaderCard(
    el.weeklyLeaderName,
    el.weeklyLeaderDetail,
    weeklySummary,
    weeklyRows.length
      ? 'No solved games yet this week.'
      : 'No solved games yet this week.'
  );

  renderLeaderCard(
    el.monthlyLeaderName,
    el.monthlyLeaderDetail,
    monthlySummary,
    monthlyRows.length
      ? 'No solved games yet this month.'
      : 'No solved games yet this month.'
  );

  renderLeaderCard(
    el.alltimeLeaderName,
    el.alltimeLeaderDetail,
    allTimeSummary,
    rows.length ? 'No all-time games yet.' : 'No all-time games yet.'
  );

  const weeklyTop3 = summarizeTopPlayers(weeklyRows).slice(0, 3);
  const previousWeekWinner = previousWeekSummary?.leader || null;

  renderWeeklyTicker(weeklyTop3, previousWeekWinner, getUniquePuzzleCount(weeklyRows));
}

async async function loadTodayStats(forcedPuzzle = null) {
  let puzzleNumber = forcedPuzzle;

  if (!puzzleNumber) {
    puzzleNumber = getCurrentChicagoPuzzleNumber();
  }

  state.currentPuzzle = puzzleNumber;

  if (el.todayPuzzleLabel) {
    el.todayPuzzleLabel.textContent = puzzleNumber ? `Puzzle #${puzzleNumber}` : 'No puzzle submissions yet';
  }

  if (!puzzleNumber) {
    if (el.todayStandings) el.todayStandings.textContent = 'No results yet.';
    if (el.todayPlayerCount) el.todayPlayerCount.textContent = '0';
    if (el.todayAverage) el.todayAverage.textContent = '—';
    if (el.todaySolveRate) el.todaySolveRate.textContent = '—';
    if (el.dailyWinnerName) el.dailyWinnerName.textContent = '—';
    if (el.dailyWinnerDetail) el.dailyWinnerDetail.textContent = `Waiting on today's solves.`;
    return;
  }

  const { data, error } = await supabase
    .from('submission_feed')
    .select('*')
    .eq('puzzle_number', puzzleNumber)
    .order('solved', { ascending: false })
    .order('score', { ascending: true, nullsFirst: false })
    .order('submitted_at', { ascending: true });

  if (error) {
    console.error(error);
    if (el.todayStandings) el.todayStandings.textContent = error.message;
    return;
  }

  const players = data || [];
  const solved = players.filter((p) => p.solved);
  const avg = solved.length
    ? (solved.reduce((sum, p) => sum + p.score, 0) / solved.length).toFixed(2)
    : '—';
  const solveRate = players.length
    ? `${Math.round((solved.length / players.length) * 100)}%`
    : '—';
  const winner = solved[0] || null;

  if (el.todayPlayerCount) el.todayPlayerCount.textContent = String(players.length);
  if (el.todayAverage) el.todayAverage.textContent = avg;
  if (el.todaySolveRate) el.todaySolveRate.textContent = solveRate;
  if (el.dailyWinnerName) el.dailyWinnerName.textContent = winner ? winner.display_name : '—';
  if (el.dailyWinnerDetail) {
    el.dailyWinnerDetail.textContent = winner
      ? `${winner.score}/6 · submitted ${new Date(winner.submitted_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : `No successful solve yet for puzzle #${puzzleNumber}.`;
  }

  if (!players.length) {
    if (el.todayStandings) el.todayStandings.textContent = 'No results yet.';
    return;
  }

  await renderTodayStandings(players);
}

async function submitResult(event) {
  event.preventDefault();

  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) throw userError;
    if (!user) throw new Error('You must be signed in before submitting.');

    const parsed = previewParse();

    await ensureProfile(
      user.id,
      user.user_metadata?.display_name || user.email.split('@')[0]
    );

    const screenshotFile = el.screenshot?.files?.[0] || null;
    const screenshotPath = await uploadScreenshot(user.id, parsed.puzzleNumber, screenshotFile);

    const payload = {
      user_id: user.id,
      puzzle_number: parsed.puzzleNumber,
      score: parsed.score,
      solved: parsed.solved,
      rows_json: parsed.rows,
      share_text: el.shareText.value.trim(),
      screenshot_path: screenshotPath,
    };

    const { error } = await supabase
      .from('submissions')
      .upsert(payload, {
        onConflict: 'user_id,puzzle_number',
      });

    if (error) throw error;

    el.submissionForm?.reset();
    if (el.parsePreview) el.parsePreview.textContent = 'Parsed result will show here.';
    showToast('Result submitted.');

    await Promise.all([
      loadTodayStats(parsed.puzzleNumber),
      loadRunningLeaders(),
    ]);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Failed to submit result.');
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();

  try {
    const email = el.email.value.trim();
    const password = el.password.value;
    const displayName = el.displayName?.value.trim();

    await signUp(email, password, displayName);
    showToast('Signed up. Check your email for the confirmation link.');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Sign up failed.');
  }
}

function wirePlayTodayButton() {
  if (!el.playTodayBtn) return;
  el.playTodayBtn.href = PLAY_WORDLE_URL;
  el.playTodayBtn.target = '_blank';
  el.playTodayBtn.rel = 'noopener noreferrer';
}

async function init() {
  try {
    wirePlayTodayButton();
    state.session = await getSession();
    setAuthUi(state.session);
    await Promise.all([loadTodayStats(), loadRunningLeaders()]);
  } catch (error) {
    console.error(error);
    if (el.authStatus) {
      el.authStatus.textContent = 'Could not initialize app. Check js/config.js';
    }
  }

  el.authForm?.addEventListener('submit', handleAuthSubmit);

  el.signInBtn?.addEventListener('click', async () => {
    try {
      const result = await signIn(el.email.value.trim(), el.password.value);
      state.session = result.session;
      setAuthUi(state.session);

      if (state.session?.user) {
        await ensureProfile(
          state.session.user.id,
          state.session.user.user_metadata?.display_name ||
            state.session.user.email.split('@')[0]
        );
      }

      showToast('Signed in.');
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Sign in failed.');
    }
  });

  el.magicLinkBtn?.addEventListener('click', async () => {
    try {
      await sendMagicLink(el.email.value.trim());
      showToast('Magic link sent.');
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Could not send magic link.');
    }
  });

  el.signOutBtn?.addEventListener('click', async () => {
    try {
      await signOut();
      state.session = null;
      setAuthUi(null);
      showToast('Signed out.');
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Sign out failed.');
    }
  });

  el.previewBtn?.addEventListener('click', () => {
    try {
      previewParse();
    } catch (error) {
      if (el.parsePreview) el.parsePreview.textContent = error.message;
    }
  });

  el.submissionForm?.addEventListener('submit', submitResult);

  supabase.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    setAuthUi(session);

    if (session?.user) {
      try {
        await ensureProfile(
          session.user.id,
          session.user.user_metadata?.display_name ||
            session.user.email.split('@')[0]
        );
      } catch (error) {
        console.error('Profile sync failed:', error);
      }
    }
  });
}

init();
