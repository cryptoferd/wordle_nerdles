import { supabase } from './supabase-client.js';
import { renderMiniGrid } from './parser.js';
import { getSession } from './auth.js';
import { mountComments, attachScreenshotToSubmission } from './comments.js';

const wrap = document.getElementById('daily-results');
const puzzleInput = document.getElementById('puzzle-input');
const prevBtn = document.getElementById('prev-puzzle');
const nextBtn = document.getElementById('next-puzzle');
const loadBtn = document.getElementById('load-puzzle');
const modal = document.getElementById('image-modal');
const modalImg = document.getElementById('modal-image');
const closeModalBtn = document.getElementById('close-modal');
const DEFAULT_AVATAR = './assets/default-avatar.svg';

let currentPuzzle = null;
let session = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function getDefaultPuzzle() {
  const { data } = await supabase
    .from('submissions')
    .select('puzzle_number')
    .order('puzzle_number', { ascending: false })
    .limit(1);
  return data?.[0]?.puzzle_number || null;
}

async function viewerHasUnlockedPuzzle(puzzleNumber) {
  if (!session?.user) return false;

  const { count, error } = await supabase
    .from('submissions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', session.user.id)
    .eq('puzzle_number', puzzleNumber);

  if (error) return false;
  return (count || 0) > 0;
}

async function getSignedScreenshotUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from('screenshots')
    .createSignedUrl(path, 60 * 10);
  if (error) return null;
  return data?.signedUrl || null;
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

function renderPlayerIdentity(row, avatarSrc, isWinner = false) {
  const name = `${isWinner && row.solved ? '👑 ' : ''}${escapeHtml(row.display_name || 'Unknown')}`;
  const catchphrase = row.catchphrase ? `<div class="catchphrase">“${escapeHtml(row.catchphrase)}”</div>` : '';

  return `
    <a class="player-link" href="profile.html?user=${encodeURIComponent(row.user_id)}">
      <div class="player-row-top">
        <img class="player-avatar circular" src="${avatarSrc}" alt="${escapeHtml(row.display_name || 'Unknown')} profile picture">
        <div class="player-meta">
          <div class="player-name-line">
            <strong>${name}</strong>
          </div>
          ${catchphrase}
          <span class="muted">${new Date(row.submitted_at).toLocaleString()}</span>
        </div>
      </div>
    </a>
  `;
}

async function loadDailyResults(puzzleNumber) {
  currentPuzzle = puzzleNumber;
  puzzleInput.value = puzzleNumber || '';

  if (!puzzleNumber) {
    wrap.textContent = 'No puzzle data yet.';
    return;
  }

  wrap.textContent = 'Loading daily results…';

  const { data, error } = await supabase
    .from('submission_feed')
    .select('*')
    .eq('puzzle_number', puzzleNumber)
    .order('solved', { ascending: false })
    .order('score', { ascending: true, nullsFirst: false })
    .order('submitted_at', { ascending: true });

  if (error) {
    wrap.textContent = error.message;
    return;
  }

  const unlocked = await viewerHasUnlockedPuzzle(puzzleNumber);
  const rows = data || [];
  const avatarMap = await getAvatarUrlMap(rows);

  if (!rows.length) {
    wrap.textContent = 'No results for this puzzle yet.';
    return;
  }

  const cards = await Promise.all(rows.map(async (row, index) => {
    const avatarSrc = avatarMap.get(row.avatar_url) || DEFAULT_AVATAR;
    let screenshotHtml = '';
    const isOwn = session?.user?.id === row.user_id;
    if (row.screenshot_path) {
      if (unlocked || isOwn) {
        const signedUrl = await getSignedScreenshotUrl(row.screenshot_path);
        screenshotHtml = signedUrl
          ? `<div class="screenshot-card"><img src="${signedUrl}" alt="${escapeHtml(row.display_name)} screenshot" data-fullsrc="${signedUrl}" /></div>`
          : `<div class="screenshot-locked">Screenshot unavailable.</div>`;
      } else {
        screenshotHtml = `<div class="screenshot-locked">Submit this puzzle to unlock screenshots.</div>`;
      }
    } else if (isOwn) {
      screenshotHtml = `
        <div class="screenshot-uploader-inline">
          <label class="inline-upload-label">Forgot your screenshot?</label>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif" data-add-screenshot-input="${row.id}">
          <button type="button" class="ghost-btn" data-add-screenshot-btn="${row.id}">Add screenshot</button>
        </div>
      `;
    }

    return `
      <article class="player-card">
        <div class="player-row">
          ${renderPlayerIdentity(row, avatarSrc, index === 0)}
          <div class="score-pill">${row.solved ? `${row.score}/6` : 'X/6'}</div>
        </div>
        <div class="mini-grid">${renderMiniGrid(row.rows_json || [])}</div>
        ${screenshotHtml}
        <div class="submission-comments" data-comments-host="${row.id}"></div>
      </article>
    `;
  }));

  wrap.innerHTML = `<div class="daily-card-grid">${cards.join('')}</div>`;

  wrap.querySelectorAll('img[data-fullsrc]').forEach((img) => {
    img.addEventListener('click', () => openModal(img.dataset.fullsrc));
  });

  wrap.querySelectorAll('[data-add-screenshot-btn]').forEach((button) => {
    button.addEventListener('click', async () => {
      const submissionId = button.dataset.addScreenshotBtn;
      const input = wrap.querySelector(`[data-add-screenshot-input="${submissionId}"]`);
      const file = input?.files?.[0];
      const submission = rows.find((entry) => entry.id === submissionId);

      if (!submission) return;

      try {
        await attachScreenshotToSubmission(submission, file);
        await loadDailyResults(puzzleNumber);
      } catch (error) {
        console.error(error);
        alert(error.message || 'Could not add screenshot.');
      }
    });
  });

  await mountComments({
    container: wrap,
    submissions: rows,
    session,
    onError: (error) => alert(error.message || 'Could not load comments.'),
    onSuccess: () => loadDailyResults(puzzleNumber),
  });
}

function openModal(src) {
  modalImg.src = src;
  modal.classList.remove('hidden');
}

function closeModal() {
  modal.classList.add('hidden');
  modalImg.src = '';
}

prevBtn?.addEventListener('click', () => {
  if (!currentPuzzle || currentPuzzle <= 1) return;
  loadDailyResults(currentPuzzle - 1);
});

nextBtn?.addEventListener('click', () => {
  if (!currentPuzzle) return;
  loadDailyResults(currentPuzzle + 1);
});

loadBtn?.addEventListener('click', () => {
  const value = Number(puzzleInput.value);
  if (!Number.isFinite(value) || value < 1) return;
  loadDailyResults(value);
});

closeModalBtn?.addEventListener('click', closeModal);
modal?.addEventListener('click', (event) => {
  if (event.target?.dataset?.close === 'true') closeModal();
});

(async function init() {
  session = await getSession();
  const puzzle = await getDefaultPuzzle();
  await loadDailyResults(puzzle);
})();
