import { supabase } from './supabase-client.js';
import { renderMiniGrid } from './parser.js';
import { getSession } from './auth.js';

const wrap = document.getElementById('daily-results');
const puzzleInput = document.getElementById('puzzle-input');
const prevBtn = document.getElementById('prev-puzzle');
const nextBtn = document.getElementById('next-puzzle');
const loadBtn = document.getElementById('load-puzzle');
const modal = document.getElementById('image-modal');
const modalImg = document.getElementById('modal-image');
const closeModalBtn = document.getElementById('close-modal');

let currentPuzzle = null;
let session = null;

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
  return data.signedUrl;
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

  if (!rows.length) {
    wrap.textContent = 'No results for this puzzle yet.';
    return;
  }

  const cards = await Promise.all(rows.map(async (row) => {
    let screenshotHtml = '';
    if (row.screenshot_path) {
      if (unlocked) {
        const signedUrl = await getSignedScreenshotUrl(row.screenshot_path);
        screenshotHtml = signedUrl
          ? `<div class="screenshot-card"><img src="${signedUrl}" alt="${escapeHtml(row.display_name)} screenshot" data-fullsrc="${signedUrl}" /></div>`
          : `<div class="screenshot-locked">Screenshot unavailable.</div>`;
      } else {
        screenshotHtml = `<div class="screenshot-locked">Submit this puzzle to unlock screenshots.</div>`;
      }
    }

    return `
      <article class="player-card">
        <div class="player-row">
          <div class="player-meta">
            <strong>${escapeHtml(row.display_name || 'Unknown')}</strong>
            <span class="muted">${new Date(row.submitted_at).toLocaleString()}</span>
          </div>
          <div class="score-pill">${row.solved ? `${row.score}/6` : 'X/6'}</div>
        </div>
        <div class="mini-grid">${renderMiniGrid(row.rows_json || [])}</div>
        ${screenshotHtml}
      </article>
    `;
  }));

  wrap.innerHTML = `<div class="daily-card-grid">${cards.join('')}</div>`;

  wrap.querySelectorAll('img[data-fullsrc]').forEach((img) => {
    img.addEventListener('click', () => openModal(img.dataset.fullsrc));
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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function init() {
  session = await getSession();
  const defaultPuzzle = await getDefaultPuzzle();
  await loadDailyResults(defaultPuzzle);

  loadBtn.addEventListener('click', () => loadDailyResults(Number(puzzleInput.value)));
  prevBtn.addEventListener('click', () => loadDailyResults(Math.max(1, Number(currentPuzzle || 2) - 1)));
  nextBtn.addEventListener('click', () => loadDailyResults(Number(currentPuzzle || 0) + 1));
  closeModalBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => {
    if (event.target.dataset.close === 'true') closeModal();
  });
}

init();
