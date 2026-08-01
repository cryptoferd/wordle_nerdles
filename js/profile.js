import { supabase } from './supabase-client.js';
import { getSession } from './auth.js';
import { renderMiniGrid } from './parser.js';

const wrap = document.getElementById('profile-wrap');
const toast = document.getElementById('toast');
const DEFAULT_AVATAR = './assets/default-avatar.svg';

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

function renderRecentSubmissions(submissions) {
  if (!submissions?.length) {
    return '<p class="muted">No submissions yet.</p>';
  }

  return `
    <div class="recent-submissions-grid">
      ${submissions.slice(0, 12).map((row) => `
        <article class="player-card">
          <div class="player-row">
            <div class="player-meta">
              <div class="player-name-line">
                <strong>Puzzle #${row.puzzle_number}</strong>
              </div>
              <span class="muted">${new Date(row.submitted_at).toLocaleString()}</span>
            </div>
            <div class="score-pill">${row.solved ? `${row.score}/6` : 'X/6'}</div>
          </div>
          <div class="mini-grid">${renderMiniGrid(row.rows_json || [])}</div>
        </article>
      `).join('')}
    </div>
  `;
}

async function renderOwnProfile(session, profile, submissions, avatarSrc) {
  const stats = computeStats(submissions);

  wrap.innerHTML = `
    <div class="profile-shell">
      <section class="profile-header-card">
        <div class="profile-header-main">
          <div class="avatar-wrap large">
            <img id="profile-avatar" class="profile-avatar circular" src="${avatarSrc}" alt="${escapeHtml(profile.display_name)} profile picture">
          </div>
          <div>
            <h2>${escapeHtml(profile.display_name)}</h2>
            <p class="tagline">Your public player card and personal stats.</p>
            <p class="muted">${profile.catchphrase ? `“${escapeHtml(profile.catchphrase)}”` : 'Add a catchphrase that sounds like you.'}</p>
          </div>
        </div>

        <div class="summary-grid">
          <article class="summary-card"><span class="summary-label">Solved</span><strong>${stats.solvedCount}</strong><p class="muted">Out of ${stats.total} submissions</p></article>
          <article class="summary-card"><span class="summary-label">Average</span><strong>${stats.average}</strong><p class="muted">Average winning score</p></article>
          <article class="summary-card"><span class="summary-label">Best</span><strong>${stats.best === '—' ? '—' : `${stats.best}/6`}</strong><p class="muted">Best winning result</p></article>
          <article class="summary-card"><span class="summary-label">Solve rate</span><strong>${stats.solveRate}</strong><p class="muted">Across all submissions</p></article>
        </div>
      </section>

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

      <section class="card">
        <div class="section-head">
          <h3>Recent submissions</h3>
          <span class="badge">Latest 12</span>
        </div>
        ${renderRecentSubmissions(submissions)}
      </section>
    </div>
  `;

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
      await loadProfile();
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
      await loadProfile();
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Could not upload profile picture.');
    }
  });
}

function renderViewOnlyProfile(session, profile, submissions, avatarSrc, isSelfLink) {
  const stats = computeStats(submissions);
  const pageLabel = isSelfLink ? 'This is your public player card.' : 'Public player card';

  wrap.innerHTML = `
    <div class="profile-shell">
      <section class="profile-header-card">
        <div class="profile-view-header">
          <div class="avatar-wrap large">
            <img class="profile-avatar circular" src="${avatarSrc}" alt="${escapeHtml(profile.display_name)} profile picture">
          </div>
          <div>
            <h2>${escapeHtml(profile.display_name)}</h2>
            <p class="profile-view-subtitle">${pageLabel}</p>
            <p class="muted">${profile.catchphrase ? `“${escapeHtml(profile.catchphrase)}”` : 'No catchphrase yet.'}</p>
            <button id="favorite-profile-btn" class="favorite-profile-btn ghost-btn" type="button" aria-pressed="false">
              ☆ Notify me when this player submits
            </button>
          </div>
        </div>

        <div class="profile-view-grid">
          <article class="summary-card"><span class="summary-label">Solved</span><strong>${stats.solvedCount}</strong><p class="muted">Out of ${stats.total} submissions</p></article>
          <article class="summary-card"><span class="summary-label">Average</span><strong>${stats.average}</strong><p class="muted">Average winning score</p></article>
          <article class="summary-card"><span class="summary-label">Best</span><strong>${stats.best === '—' ? '—' : `${stats.best}/6`}</strong><p class="muted">Best winning result</p></article>
          <article class="summary-card"><span class="summary-label">Solve rate</span><strong>${stats.solveRate}</strong><p class="muted">Across all submissions</p></article>
        </div>
      </section>

      <section class="card">
        <div class="section-head">
          <h3>Recent submissions</h3>
          <span class="badge">Latest 12</span>
        </div>
        ${renderRecentSubmissions(submissions)}
      </section>
    </div>
  `;

  wireFavoriteButton(session.user.id, profile.id);
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

  const [{ data: profile, error: profileError }, { data: submissions, error: submissionsError }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', targetUserId).single(),
    supabase.from('submissions').select('*').eq('user_id', targetUserId).order('puzzle_number', { ascending: false }),
  ]);

  if (profileError) {
    wrap.textContent = profileError.message;
    return;
  }
  if (submissionsError) {
    wrap.textContent = submissionsError.message;
    return;
  }

  const avatarSrc = await getAvatarSignedUrl(profile?.avatar_url) || DEFAULT_AVATAR;

  if (isOwnProfile) {
    await renderOwnProfile(session, profile, submissions || [], avatarSrc);
  } else {
    renderViewOnlyProfile(session, profile, submissions || [], avatarSrc, false);
  }
}

loadProfile();
