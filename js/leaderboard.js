import { supabase } from './supabase-client.js';

const wrap = document.getElementById('leaderboard-table-wrap');
const buttons = [...document.querySelectorAll('.filter-btn')];

async function loadLeaderboard(range = 'all') {
  wrap.textContent = 'Loading leaderboard…';

  let query = supabase.from('submission_feed').select('*').eq('solved', true);

  if (range !== 'all') {
    const days = Number(range);
    const since = new Date();
    since.setDate(since.getDate() - days);
    query = query.gte('submitted_at', since.toISOString());
  }

  const { data, error } = await query.order('submitted_at', { ascending: false });
  if (error) {
    wrap.textContent = error.message;
    return;
  }

  const byUser = new Map();
  for (const row of data || []) {
    const current = byUser.get(row.user_id) || {
      display_name: row.display_name || 'Unknown',
      games: 0,
      totalScore: 0,
      best: null,
      latest: null,
    };
    current.games += 1;
    current.totalScore += row.score;
    current.best = current.best == null ? row.score : Math.min(current.best, row.score);
    current.latest = current.latest || row.submitted_at;
    byUser.set(row.user_id, current);
  }

  const leaderboard = [...byUser.values()]
    .map((row) => ({
      ...row,
      average: row.games ? row.totalScore / row.games : null,
    }))
    .sort((a, b) => (a.average ?? 99) - (b.average ?? 99));

  if (!leaderboard.length) {
    wrap.textContent = 'No leaderboard data yet.';
    return;
  }

  wrap.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th>Games solved</th>
            <th>Average</th>
            <th>Best</th>
          </tr>
        </thead>
        <tbody>
          ${leaderboard.map((row, index) => `
            <tr>
              <td>${index + 1}</td>
              <td>${escapeHtml(row.display_name)}</td>
              <td>${row.games}</td>
              <td>${row.average.toFixed(2)}</td>
              <td>${row.best}/6</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
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

buttons.forEach((button) => {
  button.addEventListener('click', () => {
    buttons.forEach((btn) => btn.classList.remove('active'));
    button.classList.add('active');
    loadLeaderboard(button.dataset.range);
  });
});

loadLeaderboard('all');
