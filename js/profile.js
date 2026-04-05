import { supabase } from './supabase-client.js';
import { getSession } from './auth.js';
import { renderMiniGrid } from './parser.js';

const wrap = document.getElementById('profile-wrap');

async function init() {
  const session = await getSession();
  if (!session?.user) {
    wrap.innerHTML = '<p>Please sign in on the Today page first.</p>';
    return;
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();

  const { data: submissions, error } = await supabase
    .from('submissions')
    .select('*')
    .eq('user_id', session.user.id)
    .order('puzzle_number', { ascending: false });

  if (error) {
    wrap.textContent = error.message;
    return;
  }

  const solved = (submissions || []).filter((row) => row.solved);
  const average = solved.length ? (solved.reduce((sum, row) => sum + row.score, 0) / solved.length).toFixed(2) : '—';

  wrap.innerHTML = `
    <div class="section-head"><h2>${escapeHtml(profile?.display_name || session.user.email)}</h2></div>
    <div class="hero-stats">
      <div class="stat-box"><span>Total submissions</span><strong>${submissions?.length || 0}</strong></div>
      <div class="stat-box"><span>Solved</span><strong>${solved.length}</strong></div>
      <div class="stat-box"><span>Average</span><strong>${average}</strong></div>
    </div>
    <div class="standings-list" style="margin-top: 18px;">
      ${(submissions || []).map((row) => `
        <article class="player-card">
          <div class="player-row">
            <strong>Puzzle #${row.puzzle_number}</strong>
            <div class="score-pill">${row.solved ? `${row.score}/6` : 'X/6'}</div>
          </div>
          <div class="mini-grid">${renderMiniGrid(row.rows_json || [])}</div>
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

init();
