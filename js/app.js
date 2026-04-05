import { supabase } from './supabase-client.js';
import { parseWordleShare, renderMiniGrid } from './parser.js';
import { getSession, signIn, signOut, signUp, sendMagicLink, ensureProfile } from './auth.js';

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
  toast: document.getElementById('toast'),
};

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.toast.classList.add('hidden'), 3000);
}

function setAuthUi(session) {
  if (session?.user) {
    el.authStatus.textContent = `Signed in as ${session.user.email}`;
    el.signOutBtn.classList.remove('hidden');
  } else {
    el.authStatus.textContent = 'Not signed in.';
    el.signOutBtn.classList.add('hidden');
  }
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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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
      if (a.average !== b.average) return a.average - b.average;
      if (a.games !== b.games) return b.games - a.games;
      if (a.best !== b.best) return a.best - b.best;
      return a.display_name.localeCompare(b.display_name);
    });

  return {
    leaderboard,
    leader: leaderboard[0],
  };
}

function renderLeaderCard(nameEl, detailEl, summary, emptyText) {
  if (!summary?.leader) {
    nameEl.textContent = '—';
    detailEl.textContent = emptyText;
    return;
  }

  const leader = summary.leader;
  nameEl.textContent = leader.display_name;
  detailEl.textContent = `${leader.average.toFixed(2)} avg across ${leader.games} solved game${leader.games === 1 ? '' : 's'}`;
}

function renderTodayStandings(players) {
  el.todayStandings.innerHTML = `
    <div class="standings-list">
      ${players.map((player, index) => `
        <article class="player-card">
          <div class="player-row">
            <div class="player-meta">
              <strong>${index === 0 && player.solved ? '👑 ' : ''}${escapeHtml(player.display_name || 'Unknown')}</strong>
              <span class="muted">${new Date(player.submitted_at).toLocaleString()}</span>
            </div>
            <div class="score-pill">${player.solved ? `${player.score}/6` : 'X/6'}</div>
          </div>
          ${index === 0 && player.solved ? `<div class="winner-banner">Daily winner — first best solve for puzzle #${player.puzzle_number}</div>` : ''}
          <div class="mini-grid">${renderMiniGrid(player.rows_json || [])}</div>
        </article>
      `).join('')}
    </div>
  `;
}

async function loadRunningLeaders() {
  const { data, error } = await supabase
    .from('submission_feed')
    .select('user_id, display_name, score, solved, submitted_at');

  if (error) {
    console.error(error);
    return;
  }

  const rows = data || [];
  const now = Date.now();
  const weekCutoff = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthCutoff = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  renderLeaderCard(
    el.weeklyLeaderName,
    el.weeklyLeaderDetail,
    summarizeLeaderboard(rows.filter((r) => r.submitted_at >= weekCutoff)),
    'No weekly games yet.'
  );

  renderLeaderCard(
    el.monthlyLeaderName,
    el.monthlyLeaderDetail,
    summarizeLeaderboard(rows.filter((r) => r.submitted_at >= monthCutoff)),
    'No monthly games yet.'
  );

  renderLeaderCard(
    el.alltimeLeaderName,
    el.alltimeLeaderDetail,
    summarizeLeaderboard(rows),
    'No all-time games yet.'
  );
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

    await ensureProfile(user.id, user.user_metadata?.display_name || user.email.split('@')[0]);

    const screenshotFile = el.screenshot.files?.[0] || null;
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

    el.submissionForm.reset();
    el.parsePreview.textContent = 'Parsed result will show here.';
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

async function loadTodayStats(forcedPuzzle = null) {
  let puzzleNumber = forcedPuzzle;

  if (!puzzleNumber) {
    const { data: latestRows } = await supabase
      .from('submissions')
      .select('puzzle_number')
      .order('puzzle_number', { ascending: false })
      .limit(1);

    puzzleNumber = latestRows?.[0]?.puzzle_number || null;
  }

  state.currentPuzzle = puzzleNumber;
  el.todayPuzzleLabel.textContent = puzzleNumber ? `Puzzle #${puzzleNumber}` : 'No puzzle submissions yet';

  if (!puzzleNumber) {
    el.todayStandings.textContent = 'No results yet.';
    el.todayPlayerCount.textContent = '0';
    el.todayAverage.textContent = '—';
    el.todaySolveRate.textContent = '—';
    el.dailyWinnerName.textContent = '—';
    el.dailyWinnerDetail.textContent = `Waiting on today's solves.`;
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
    el.todayStandings.textContent = error.message;
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

  el.todayPlayerCount.textContent = String(players.length);
  el.todayAverage.textContent = avg;
  el.todaySolveRate.textContent = solveRate;
  el.dailyWinnerName.textContent = winner ? winner.display_name : '—';
  el.dailyWinnerDetail.textContent = winner
    ? `${winner.score}/6 · submitted ${new Date(winner.submitted_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : `No successful solve yet for puzzle #${puzzleNumber}.`;

  if (!players.length) {
    el.todayStandings.textContent = 'No results yet.';
    return;
  }

  renderTodayStandings(players);
}

async function handleAuthSubmit(event) {
  event.preventDefault();

  try {
    const email = el.email.value.trim();
    const password = el.password.value;
    const displayName = el.displayName.value.trim();

    await signUp(email, password, displayName);
    showToast('Signed up. Check your email for the confirmation link.');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Sign up failed.');
  }
}

async function init() {
  try {
    state.session = await getSession();
    setAuthUi(state.session);
    await Promise.all([loadTodayStats(), loadRunningLeaders()]);
  } catch (error) {
    console.error(error);
    el.authStatus.textContent = 'Could not initialize app. Check js/config.js';
  }

  el.authForm.addEventListener('submit', handleAuthSubmit);

  el.signInBtn.addEventListener('click', async () => {
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

  el.magicLinkBtn.addEventListener('click', async () => {
    try {
      await sendMagicLink(el.email.value.trim());
      showToast('Magic link sent.');
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Could not send magic link.');
    }
  });

  el.signOutBtn.addEventListener('click', async () => {
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

  el.previewBtn.addEventListener('click', () => {
    try {
      previewParse();
    } catch (error) {
      el.parsePreview.textContent = error.message;
    }
  });

  el.submissionForm.addEventListener('submit', submitResult);

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
