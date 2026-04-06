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

async function loadProfile() {
  const session = await getSession();
  if (!session?.user) {
    wrap.innerHTML = '<p>Please sign in on the Today page first.</p>';
    return;
  }

  const [{ data: profile, error: profileError }, { data: submissions, error: submissionsError }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', session.user.id).single(),
    supabase.from('submissions').select('*').eq('user_id', session.user.id).order('puzzle_number', { ascending: false }),
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
  const solved = (submissions || []).filter((row) => row.solved);
  const average = solved.length ? (solved.reduce((sum, row) => sum + row.score, 0) / solved.length).toFixed(2) : '—';

  wrap.innerHTML = `
    <div class="profile-shell">
      <section class="profile-header-card">
        <div class="profile-header-main">
          <div class="avatar-wrap large">
            <img id="profile-avatar" class="profile-avatar circular" src="${avatarSrc}" alt="${escapeHtml(profile?.display_name || session.user.email)} avatar" />
          </div>
          <div class="profile-header-copy">
            <h2>${escapeHtml(profile?.display_name || session.user.email)}</h2>
            <p class="profile-email muted">${escapeHtml(session.user.email)}</p>
            <p id="catchphrase-preview" class="catchphrase-display">${profile?.catchphrase ? `“${escapeHtml(profile.catchphrase)}”` : 'Add a catchphrase to give your profile some personality.'}</p>
          </div>
        </div>
        <div class="hero-stats profile-stats">
          <div class="stat-box"><span>Total submissions</span><strong>${submissions?.length || 0}</strong></div>
          <div class="stat-box"><span>Solved</span><strong>${solved.length}</strong></div>
          <div class="stat-box"><span>Average</span><strong>${average}</strong></div>
        </div>
      </section>

      <section class="card profile-card-inner">
        <div class="section-head"><h3>Edit profile</h3></div>
        <form id="profile-form" class="stack-form">
          <label>
            Display name
            <input id="profile-display-name" type="text" maxlength="40" value="${escapeHtml(profile?.display_name || '')}" placeholder="How you want to appear" />
          </label>
          <label>
            Catchphrase
            <textarea id="profile-catchphrase" rows="3" maxlength="120" placeholder="A one-liner that represents you">${escapeHtml(profile?.catchphrase || '')}</textarea>
          </label>
          <label>
            Profile picture
            <input id="avatar-file" type="file" accept="image/png,image/jpeg,image/webp" />
          </label>
          <div class="button-row wrap">
            <button id="save-profile-btn" type="submit">Save profile</button>
          </div>
        </form>
      </section>

      <section class="card">
        <div class="section-head"><h3>Your recent boards</h3></div>
        <div class="standings-list">
          ${(submissions || []).map((row) => `
            <article class="player-card">
              <div class="player-row">
                <strong>Puzzle #${row.puzzle_number}</strong>
                <div class="score-pill">${row.solved ? `${row.score}/6` : 'X/6'}</div>
              </div>
              <div class="mini-grid">${renderMiniGrid(row.rows_json || [])}</div>
            </article>
          `).join('') || '<div class="empty-state">No submissions yet.</div>'}
        </div>
      </section>
    </div>
  `;

  const form = document.getElementById('profile-form');
  const displayNameInput = document.getElementById('profile-display-name');
  const catchphraseInput = document.getElementById('profile-catchphrase');
  const avatarInput = document.getElementById('avatar-file');
  const avatarImg = document.getElementById('profile-avatar');
  const catchphrasePreview = document.getElementById('catchphrase-preview');

  avatarInput?.addEventListener('change', () => {
    const file = avatarInput.files?.[0];
    if (!file) return;
    avatarImg.src = URL.createObjectURL(file);
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const updates = {
        display_name: displayNameInput.value.trim() || session.user.email.split('@')[0],
        catchphrase: catchphraseInput.value.trim() || null,
      };

      const { error: updateError } = await supabase.from('profiles').update(updates).eq('id', session.user.id);
      if (updateError) throw updateError;

      const file = avatarInput?.files?.[0];
      if (file) {
        const path = await uploadAvatar(session.user.id, file);
        const signedUrl = await getAvatarSignedUrl(path);
        avatarImg.src = signedUrl || DEFAULT_AVATAR;
      }

      catchphrasePreview.textContent = updates.catchphrase
        ? `“${updates.catchphrase}”`
        : 'Add a catchphrase to give your profile some personality.';

      showToast('Profile updated.');
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Could not save profile.');
    }
  });
}

loadProfile();
