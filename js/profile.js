import { supabase } from './supabase-client.js';
import { getSession } from './auth.js';
import { renderMiniGrid } from './parser.js';

const wrap = document.getElementById('profile-wrap');
const toast = document.getElementById('toast');
const DEFAULT_AVATAR = './assets/default-avatar.svg';
const HISTORY_PAGE_SIZE = 24;

const pageState = {
  historyPage: 1,
};

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getRequestedUserId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('user');
}

async function getAvatarSignedUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('avatars').createSignedUrl(path, 60 * 60);
  if (error) {
    console.error(error);
    return null;
  }
  return data?.signedUrl || null;
}

async function getScreenshotSignedUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('screenshots').createSignedUrl(path, 60 * 10);
  if (error) {
    console.error(error);
    return null;
  }
  return data?.signedUrl || null;
}

async function uploadAvatar(userId, file) {
  if (!file) throw new Error('Choose an image first.');

  const allowed = ['image/png', 'image/jpeg', 'image/webp'];
  if (!allowed.includes(file.type)) throw new Error('Use PNG, JPG, or WebP.');
  if (file.size > 2 * 1024 * 1024) throw new Error('Avatar must be 2 MB or smaller.');

  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const path = `${userId}/avatar.${ext}`;

  const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, {
    upsert: true,
    cacheControl: '3600',
  });
  if (uploadError) throw uploadError;

  const { error: profileError } = await supabase.from('profiles').update({ avatar_url: path }).eq('id', userId);
  if (profileError) throw profileError;

  return path;
}

async function isFavoriteProfile(followerId, favoriteUserId) {
  const { data, error } = await supabase
    .from('profile_favorites')
    .select('favorite_user_id')
    .eq('follower_id', followerId)
    .eq('favorite_user_id', favoriteUserId)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

async function setFavoriteProfile(followerId, favoriteUserId, shouldFavorite) {
  if (shouldFavorite) {
    const { error } = await supabase
      .from('profile_favorites')
      .insert({
        follower_id: followerId,
        favorite_user_id: favoriteUserId,
      });

    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from('profile_favorites')
    .delete()
    .eq('follower_id', followerId)
    .eq('favorite_user_id', favoriteUserId);

  if (error) throw error;
}

async function wireFavoriteButton(sessionUserId, targetUserId) {
  const button = document.getElementById('favorite-profile-btn');
  if (!button) return;

  let isFavorite;

  try {
    isFavorite = await isFavoriteProfile(sessionUserId, targetUserId);
  } catch (error) {
    console.error(error);
    button.textContent = 'Run notification SQL to enable favorites';
    button.disabled = true;
    return;
  }

  const updateLabel = () => {
    button.textContent = isFavorite
      ? '★ Puzzle notifications enabled'
      : '☆ Notify me when this player submits';
    button.classList.toggle('active', isFavorite);
    button.setAttribute('aria-pressed', String(isFavorite));
  };

  updateLabel();

  button.addEventListener('click', async () => {
    button.disabled = true;

    try {
      await setFavoriteProfile(sessionUserId, targetUserId, !isFavorite);
      isFavorite = !isFavorite;
      updateLabel();
      showToast(isFavorite
        ? 'You will be notified when this player submits.'
        : 'Submission notifications disabled for this player.');
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Could not update favorite.');
    } finally {
      button.disabled = false;
    }
  });
}

function computeStats(submissions) {
  const solved = (submissions || []).filter((row) => row.solved && Number.isFinite(row.score));
  const total = submissions?.length || 0;
  const solvedCount = solved.length;
  const average = solvedCount ? (solved.reduce((sum, row) => sum + row.score, 0) / solvedCount).toFixed(2) : '—';
  const best = solvedCount ? Math.min(...solved.map((row) => row.score)) : '—';
  const solveRate = total ? `${Math.round((solvedCount / total) * 100)}%` : '—';
  return { total, solvedCount, average, best, solveRate };
}

function getHallOfFame(submissions) {
  return (submissions || [])
    .filter((row) => row.solved && Number.isFinite(row.score))
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return b.puzzle_number - a.puzzle_number;
    })
    .slice(0, 3);
}

function getHallOfShame(submissions) {
  return [...(submissions || [])]
    .sort((a, b) => {
      if (a.solved !== b.solved) return a.solved ? 1 : -1;
      if ((a.score ?? 7) !== (b.score ?? 7)) return (b.score ?? 7) - (a.score ?? 7);
      return b.puzzle_number - a.puzzle_number;
    })[0] || null;
}

function canViewScreenshot(submission, viewerId, targetUserId, viewerPuzzleNumbers) {
  return Boolean(
    submission?.screenshot_path
    && (
      viewerId === targetUserId
      || viewerPuzzleNumbers.has(submission.puzzle_number)
    )
  );
}

async function buildScreenshotMap(submissions, viewerId, targetUserId, viewerPuzzleNumbers) {
  const allowed = (submissions || []).filter((row) =>
    canViewScreenshot(row, viewerId, targetUserId, viewerPuzzleNumbers)
  );

  const entries = await Promise.all(allowed.map(async (row) => [
    row.id,
    await getScreenshotSignedUrl(row.screenshot_path),
  ]));

  return new Map(entries);
}

function resultLabel(row) {
  return row.solved ? `${row.score}/6` : 'X/6';
}

function screenshotHtml(row, screenshotMap, compact = false) {
  if (!row.screenshot_path) {
    return `<div class="profile-shot-empty muted">No screenshot added.</div>`;
  }

  const url = screenshotMap.get(row.id);
  if (!url) {
    return `<div class="profile-shot-empty muted">Complete puzzle #${row.puzzle_number} to unlock this screenshot.</div>`;
  }

  return `
    <a class="profile-shot-link" href="${url}" target="_blank" rel="noopener noreferrer">
      <img class="profile-puzzle-shot ${compact ? 'compact' : ''}" src="${url}" alt="Screenshot for puzzle #${row.puzzle_number}">
    </a>
  `;
}

function renderSpotlightCard(row, screenshotMap, label) {
  if (!row) {
    return `<article class="profile-spotlight-card"><p class="muted">No qualifying puzzle yet.</p></article>`;
  }

  return `
    <article class="profile-spotlight-card">
      <div class="profile-spotlight-head">
        <div>
          <span class="summary-label">${escapeHtml(label)}</span>
          <strong>Puzzle #${row.puzzle_number}</strong>
        </div>
        <span class="score-pill">${resultLabel(row)}</span>
      </div>
      ${screenshotHtml(row, screenshotMap, true)}
      <div class="mini-grid profile-mini-grid">${renderMiniGrid(row.rows_json || [])}</div>
      <span class="muted small">${new Date(row.submitted_at).toLocaleDateString()}</span>
    </article>
  `;
}

function renderHistoryCard(row, screenshotMap) {
  return `
    <article class="profile-history-card">
      <div class="player-row">
        <div class="player-meta">
          <div class="player-name-line">
            <strong>Puzzle #${row.puzzle_number}</strong>
          </div>
          <span class="muted">${new Date(row.submitted_at).toLocaleString()}</span>
        </div>
        <div class="score-pill">${resultLabel(row)}</div>
      </div>
      <div class="mini-grid profile-mini-grid">${renderMiniGrid(row.rows_json || [])}</div>
      ${screenshotHtml(row, screenshotMap)}
    </article>
  `;
}

function renderHistorySection(submissions, screenshotMap) {
  const totalPages = Math.max(1, Math.ceil(submissions.length / HISTORY_PAGE_SIZE));
  pageState.historyPage = Math.min(pageState.historyPage, totalPages);

  const start = (pageState.historyPage - 1) * HISTORY_PAGE_SIZE;
  const visibleRows = submissions.slice(start, start + HISTORY_PAGE_SIZE);

  return `
    <section class="card">
      <div class="section-head wrap">
        <div>
          <h3>Complete Puzzle History</h3>
          <p class="muted">${submissions.length} total submission${submissions.length === 1 ? '' : 's'}</p>
        </div>
        <span class="badge">Page ${pageState.historyPage} of ${totalPages}</span>
      </div>

      ${visibleRows.length
        ? `<div class="profile-history-grid">${visibleRows.map((row) => renderHistoryCard(row, screenshotMap)).join('')}</div>`
        : '<p class="muted">No submissions yet.</p>'}

      ${totalPages > 1 ? `
        <div class="pagination-row profile-history-pagination">
          <button id="profile-history-prev" type="button" class="ghost-btn" ${pageState.historyPage <= 1 ? 'disabled' : ''}>Previous</button>
          <span>Page ${pageState.historyPage} of ${totalPages}</span>
          <button id="profile-history-next" type="button" class="ghost-btn" ${pageState.historyPage >= totalPages ? 'disabled' : ''}>Next</button>
        </div>
      ` : ''}
    </section>
  `;
}

function profileHeaderHtml(profile, stats, avatarSrc, isOwnProfile) {
  return `
    <section class="profile-header-card">
      <div class="${isOwnProfile ? 'profile-header-main' : 'profile-view-header'}">
        <div class="avatar-wrap large">
          <img class="profile-avatar circular" src="${avatarSrc}" alt="${escapeHtml(profile.display_name)} profile picture">
        </div>
        <div>
          <h2>${escapeHtml(profile.display_name)}</h2>
          <p class="${isOwnProfile ? 'tagline' : 'profile-view-subtitle'}">${isOwnProfile ? 'Your public player card and personal stats.' : 'Public player card'}</p>
          <p class="muted">${profile.catchphrase ? `“${escapeHtml(profile.catchphrase)}”` : (isOwnProfile ? 'Add a catchphrase that sounds like you.' : 'No catchphrase yet.')}</p>
          ${isOwnProfile ? '' : `
            <button id="favorite-profile-btn" class="favorite-profile-btn ghost-btn" type="button" aria-pressed="false">
              ☆ Notify me when this player submits
            </button>
          `}
        </div>
      </div>

      <div class="${isOwnProfile ? 'summary-grid' : 'profile-view-grid'}">
        <article class="summary-card"><span class="summary-label">Solved</span><strong>${stats.solvedCount}</strong><p class="muted">Out of ${stats.total} submissions</p></article>
        <article class="summary-card"><span class="summary-label">Average</span><strong>${stats.average}</strong><p class="muted">Average winning score</p></article>
        <article class="summary-card"><span class="summary-label">Best</span><strong>${stats.best === '—' ? '—' : `${stats.best}/6`}</strong><p class="muted">Best winning result</p></article>
        <article class="summary-card"><span class="summary-label">Solve rate</span><strong>${stats.solveRate}</strong><p class="muted">Across all submissions</p></article>
      </div>
    </section>
  `;
}

function hallsHtml(submissions, screenshotMap) {
  const fame = getHallOfFame(submissions);
  const shame = getHallOfShame(submissions);

  return `
    <section class="card profile-halls-card">
      <div class="section-head">
        <div>
          <h3>🏆 Hall of Fame</h3>
          <p class="muted">This player's three best solved puzzles.</p>
        </div>
      </div>
      <div class="profile-fame-grid">
        ${[0, 1, 2].map((index) => renderSpotlightCard(fame[index], screenshotMap, `#${index + 1} best`)).join('')}
      </div>

      <div class="profile-shame-section">
        <div class="section-head">
          <div>
            <h3>😬 Hall of Shame</h3>
            <p class="muted">The roughest result in the archive.</p>
          </div>
        </div>
        <div class="profile-shame-grid">
          ${renderSpotlightCard(shame, screenshotMap, 'Worst result')}
        </div>
      </div>
    </section>
  `;
}

function editProfileHtml(profile) {
  return `
    <section class="card">
      <div class="section-head">
        <h3>Edit profile</h3>
        <span class="badge">Visible to your group</span>
      </div>
      <div class="stack-form">
        <label>
          Catchphrase
          <input id="catchphrase-input" type="text" maxlength="120" placeholder="One line that represents you" value="${escapeHtml(profile.catchphrase || '')}">
        </label>
        <div class="button-row">
          <button id="save-catchphrase-btn" type="button">Save Catchphrase</button>
        </div>
        <label>
          Profile picture
          <input id="avatar-file" type="file" accept="image/png,image/jpeg,image/webp">
        </label>
        <div class="button-row">
          <button id="save-avatar-btn" type="button">Upload Profile Picture</button>
        </div>
      </div>
    </section>
  `;
}

function wireHistoryPagination(renderPage) {
  document.getElementById('profile-history-prev')?.addEventListener('click', () => {
    if (pageState.historyPage <= 1) return;
    pageState.historyPage -= 1;
    renderPage();
    document.querySelector('.profile-history-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.getElementById('profile-history-next')?.addEventListener('click', () => {
    pageState.historyPage += 1;
    renderPage();
    document.querySelector('.profile-history-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function wireOwnProfileEditor(session, reloadProfile) {
  const catchphraseInput = document.getElementById('catchphrase-input');
  const saveCatchphraseBtn = document.getElementById('save-catchphrase-btn');
  const avatarFileInput = document.getElementById('avatar-file');
  const saveAvatarBtn = document.getElementById('save-avatar-btn');

  saveCatchphraseBtn?.addEventListener('click', async () => {
    try {
      const value = catchphraseInput.value.trim();
      const { error } = await supabase
        .from('profiles')
        .update({ catchphrase: value || null })
        .eq('id', session.user.id);

      if (error) throw error;
      showToast('Catchphrase updated.');
      await reloadProfile();
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Could not update catchphrase.');
    }
  });

  saveAvatarBtn?.addEventListener('click', async () => {
    try {
      const file = avatarFileInput?.files?.[0];
      await uploadAvatar(session.user.id, file);
      showToast('Profile picture updated.');
      await reloadProfile();
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Could not upload profile picture.');
    }
  });
}

async function renderProfilePage({
  session,
  profile,
  submissions,
  avatarSrc,
  isOwnProfile,
  screenshotMap,
}) {
  const stats = computeStats(submissions);

  const renderPage = () => {
    wrap.innerHTML = `
      <div class="profile-shell">
        ${profileHeaderHtml(profile, stats, avatarSrc, isOwnProfile)}
        ${isOwnProfile ? editProfileHtml(profile) : ''}
        ${hallsHtml(submissions, screenshotMap)}
        ${renderHistorySection(submissions, screenshotMap)}
      </div>
    `;

    if (isOwnProfile) {
      wireOwnProfileEditor(session, loadProfile);
    } else {
      wireFavoriteButton(session.user.id, profile.id);
    }

    wireHistoryPagination(renderPage);
  };

  renderPage();
}

async function loadProfile() {
  const session = await getSession();
  if (!session?.user) {
    wrap.innerHTML = '<p>Please sign in on the Today page first.</p>';
    return;
  }

  const requestedUserId = getRequestedUserId();
  const targetUserId = requestedUserId || session.user.id;
  const isOwnProfile = targetUserId === session.user.id;
  pageState.historyPage = 1;

  const [
    { data: profile, error: profileError },
    { data: submissions, error: submissionsError },
    { data: viewerSubmissions, error: viewerSubmissionsError },
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', targetUserId).single(),
    supabase.from('submissions').select('*').eq('user_id', targetUserId).order('puzzle_number', { ascending: false }),
    supabase.from('submissions').select('puzzle_number').eq('user_id', session.user.id),
  ]);

  if (profileError) {
    wrap.textContent = profileError.message;
    return;
  }
  if (submissionsError) {
    wrap.textContent = submissionsError.message;
    return;
  }
  if (viewerSubmissionsError) {
    console.error(viewerSubmissionsError);
  }

  const avatarSrc = await getAvatarSignedUrl(profile?.avatar_url) || DEFAULT_AVATAR;
  const viewerPuzzleNumbers = new Set((viewerSubmissions || []).map((row) => row.puzzle_number));
  const screenshotMap = await buildScreenshotMap(
    submissions || [],
    session.user.id,
    targetUserId,
    viewerPuzzleNumbers
  );

  await renderProfilePage({
    session,
    profile,
    submissions: submissions || [],
    avatarSrc,
    isOwnProfile,
    screenshotMap,
  });
}

loadProfile();
