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
  toast: document.getElementById('toast'),
};

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.toast.classList.add('hidden'), 2800);
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
  try {
    const parsed = parseWordleShare(el.shareText.value);
    el.parsePreview.innerHTML = `
      <strong>Puzzle ${parsed.puzzleNumber}</strong><br>
      Score: ${parsed.solved ? `${parsed.score}/6` : 'X/6'}<br>
      <div class="mini-grid">${renderMiniGrid(parsed.rows)}</div>
    `;
    return parsed;
  } catch (error) {
    el.parsePreview.textContent = error.message;
    throw error;
  }
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

async function submitResult(event) {
  event.preventDefault();

  if (!state.session?.user) {
    showToast('Sign in first.');
    return;
  }

  let parsed;
  try {
    parsed = previewParse();
  } catch {
    return;
  }

  try {
    const screenshotPath = await uploadScreenshot(state.session.user.id, parsed.puzzleNumber, el.screenshot.files[0]);

    const payload = {
      user_id: state.session.user.id,
      puzzle_number: parsed.puzzleNumber,
      score: parsed.score,
      solved: parsed.solved,
      rows_json: parsed.rows,
      share_text: el.shareText.value.trim(),
      screenshot_path: screenshotPath,
    };

    const { error } = await supabase.from('submissions').upsert(payload, {
      onConflict: 'user_id,puzzle_number',
    });

    if (error) throw error;

    el.submissionForm.reset();
    el.parsePreview.textContent = 'Parsed result will show here.';
    showToast('Result submitted.');
    await loadTodayStats(parsed.puzzleNumber);
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
  const avg = solved.length ? (solved.reduce((sum, p) => sum + p.score, 0) / solved.length).toFixed(2) : '—';
  const solveRate = players.length ? `${Math.round((solved.length / players.length) * 100)}%` : '—';

  el.todayPlayerCount.textContent = String(players.length);
  el.todayAverage.textContent = avg;
  el.todaySolveRate.textContent = solveRate;

  if (!players.length) {
    el.todayStandings.textContent = 'No results yet.';
    return;
  }

  el.todayStandings.innerHTML = `
    <div class="standings-list">
      ${players.map((player) => `
        <article class="player-card">
          <div class="player-row">
            <div class="player-meta">
              <strong>${escapeHtml(player.display_name || 'Unknown')}</strong>
              <span class="muted">${new Date(player.submitted_at).toLocaleString()}</span>
            </div>
            <div class="score-pill">${player.solved ? `${player.score}/6` : 'X/6'}</div>
          </div>
          <div class="mini-grid">${renderMiniGrid(player.rows_json || [])}</div>
        </article>
      `).join('')}
    </div>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  try {
    const email = el.email.value.trim();
    const password = el.password.value;
    const displayName = el.displayName.value.trim();
    const result = await signUp(email, password, displayName);
    if (result.user) {
      await ensureProfile(result.user.id, displayName || email.split('@')[0]);
    }
    showToast('Signed up. Check your email if confirmation is enabled.');
  } catch (error) {
    showToast(error.message || 'Sign up failed.');
  }
}

async function init() {
  try {
    state.session = await getSession();
    setAuthUi(state.session);
    await loadTodayStats();
  } catch (error) {
    console.error(error);
    el.authStatus.textContent = 'Could not initialize app. Check js/config.js';
  }

  el.authForm.addEventListener('submit', handleAuthSubmit);
  el.signInBtn.addEventListener('click', async () => {
    try {
      state.session = (await signIn(el.email.value.trim(), el.password.value)).session;
      setAuthUi(state.session);
      showToast('Signed in.');
    } catch (error) {
      showToast(error.message || 'Sign in failed.');
    }
  });

  el.magicLinkBtn.addEventListener('click', async () => {
    try {
      await sendMagicLink(el.email.value.trim());
      showToast('Magic link sent.');
    } catch (error) {
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
      showToast(error.message || 'Sign out failed.');
    }
  });

  el.previewBtn.addEventListener('click', () => {
    try { previewParse(); } catch {}
  });

  el.submissionForm.addEventListener('submit', submitResult);

  supabase.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    setAuthUi(session);
  });
}

init();
