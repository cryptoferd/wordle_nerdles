import { supabase } from './supabase-client.js';

const DEFAULT_AVATAR = './assets/default-avatar.svg';
const MAX_NOTIFICATIONS = 30;

let currentSession = null;
let notificationChannel = null;
let panelOpen = false;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function timeAgo(timestamp) {
  const then = new Date(timestamp).getTime();
  const diffSeconds = Math.max(0, Math.floor((Date.now() - then) / 1000));

  if (diffSeconds < 60) return 'just now';
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return new Date(timestamp).toLocaleDateString();
}

async function signedAvatar(path) {
  if (!path) return DEFAULT_AVATAR;
  const { data, error } = await supabase.storage
    .from('avatars')
    .createSignedUrl(path, 60 * 60);

  return error ? DEFAULT_AVATAR : (data?.signedUrl || DEFAULT_AVATAR);
}

function destinationFor(notification) {
  if (notification.kind === 'favorite_submission' && notification.actor_user_id) {
    return `profile.html?user=${encodeURIComponent(notification.actor_user_id)}`;
  }

  if (notification.submission_id) {
    return `index.html?notification=${encodeURIComponent(notification.id)}`;
  }

  return 'index.html';
}

function installWidget() {
  if (document.getElementById('floating-user-panel')) return;

  document.body.insertAdjacentHTML('beforeend', `
    <aside id="floating-user-panel" class="floating-user-panel hidden" aria-label="Signed-in user and notifications">
      <a id="floating-profile-link" class="floating-profile-link" href="profile.html">
        <img id="floating-user-avatar" class="floating-user-avatar" src="${DEFAULT_AVATAR}" alt="">
        <span id="floating-user-name" class="floating-user-name">Profile</span>
      </a>

      <button id="notification-bell-btn" class="notification-bell-btn" type="button" aria-label="Open notifications" aria-expanded="false">
        <span aria-hidden="true">🔔</span>
        <span id="notification-count-badge" class="notification-count-badge hidden">0</span>
      </button>
    </aside>

    <section id="notification-panel" class="notification-panel hidden" aria-label="Notifications">
      <div class="notification-panel-head">
        <strong>Notifications</strong>
        <button id="notification-close-btn" class="notification-icon-btn" type="button" aria-label="Close notifications">×</button>
      </div>

      <div class="notification-panel-actions">
        <button id="notification-mark-all-btn" class="ghost-btn" type="button">Mark all read</button>
      </div>

      <div id="notification-list" class="notification-list">
        <div class="muted">Loading…</div>
      </div>
    </section>
  `);
}

async function loadCurrentProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('display_name, avatar_url')
    .eq('id', userId)
    .single();

  if (error) {
    console.error(error);
    return;
  }

  const avatarUrl = await signedAvatar(data?.avatar_url);
  const panel = document.getElementById('floating-user-panel');
  const avatar = document.getElementById('floating-user-avatar');
  const name = document.getElementById('floating-user-name');

  if (avatar) {
    avatar.src = avatarUrl;
    avatar.alt = `${data?.display_name || 'User'} profile picture`;
  }
  if (name) name.textContent = data?.display_name || 'Profile';
  panel?.classList.remove('hidden');
}

async function markNotificationRead(notificationId) {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId);

  if (error) throw error;
}

async function markAllRead() {
  if (!currentSession?.user) return;

  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_user_id', currentSession.user.id)
    .eq('is_read', false);

  if (error) throw error;
  await loadNotifications();
}

async function renderNotifications(rows) {
  const list = document.getElementById('notification-list');
  const badge = document.getElementById('notification-count-badge');
  if (!list || !badge) return;

  const unreadCount = rows.filter((row) => !row.is_read).length;
  badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
  badge.classList.toggle('hidden', unreadCount === 0);

  if (!rows.length) {
    list.innerHTML = `<div class="notification-empty muted">No notifications yet.</div>`;
    return;
  }

  const avatarEntries = await Promise.all(rows.map(async (row) => [
    row.id,
    await signedAvatar(row.actor_avatar_url),
  ]));
  const avatarMap = new Map(avatarEntries);

  list.innerHTML = rows.map((row) => `
    <button
      type="button"
      class="notification-item ${row.is_read ? '' : 'unread'}"
      data-notification-id="${row.id}"
      data-notification-url="${escapeHtml(destinationFor(row))}"
    >
      <img
        class="notification-avatar"
        src="${avatarMap.get(row.id) || DEFAULT_AVATAR}"
        alt=""
      >
      <span class="notification-copy">
        <span class="notification-message">${escapeHtml(row.message)}</span>
        <span class="notification-time">${escapeHtml(timeAgo(row.created_at))}</span>
      </span>
      ${row.is_read ? '' : '<span class="notification-unread-dot" aria-label="Unread"></span>'}
    </button>
  `).join('');

  list.querySelectorAll('[data-notification-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const notificationId = button.dataset.notificationId;
      const url = button.dataset.notificationUrl || 'index.html';

      try {
        await markNotificationRead(notificationId);
      } catch (error) {
        console.error(error);
      }

      window.location.href = url;
    });
  });
}

async function loadNotifications() {
  if (!currentSession?.user) return;

  const { data, error } = await supabase
    .from('notification_feed')
    .select('*')
    .eq('recipient_user_id', currentSession.user.id)
    .order('created_at', { ascending: false })
    .limit(MAX_NOTIFICATIONS);

  if (error) {
    console.error(error);
    const list = document.getElementById('notification-list');
    if (list) list.innerHTML = `<div class="muted">Could not load notifications. Run the notifications SQL in Supabase.</div>`;
    return;
  }

  await renderNotifications(data || []);
}

function setPanelOpen(open) {
  panelOpen = open;
  const panel = document.getElementById('notification-panel');
  const bell = document.getElementById('notification-bell-btn');

  panel?.classList.toggle('hidden', !open);
  bell?.setAttribute('aria-expanded', String(open));

  if (open) loadNotifications();
}

function wireWidget() {
  document.getElementById('notification-bell-btn')?.addEventListener('click', (event) => {
    event.stopPropagation();
    setPanelOpen(!panelOpen);
  });

  document.getElementById('notification-close-btn')?.addEventListener('click', () => {
    setPanelOpen(false);
  });

  document.getElementById('notification-mark-all-btn')?.addEventListener('click', async () => {
    try {
      await markAllRead();
    } catch (error) {
      console.error(error);
    }
  });

  document.getElementById('notification-panel')?.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  document.addEventListener('click', () => {
    if (panelOpen) setPanelOpen(false);
  });
}

function subscribeToNotifications(userId) {
  if (notificationChannel) {
    supabase.removeChannel(notificationChannel);
  }

  notificationChannel = supabase
    .channel(`notifications-${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `recipient_user_id=eq.${userId}`,
      },
      () => loadNotifications()
    )
    .subscribe();
}

async function initNotifications() {
  installWidget();
  wireWidget();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  currentSession = session;

  if (!session?.user) {
    document.getElementById('floating-user-panel')?.classList.add('hidden');
    return;
  }

  await Promise.all([
    loadCurrentProfile(session.user.id),
    loadNotifications(),
  ]);

  subscribeToNotifications(session.user.id);
}

supabase.auth.onAuthStateChange((_event, session) => {
  currentSession = session;

  if (!session?.user) {
    document.getElementById('floating-user-panel')?.classList.add('hidden');
    document.getElementById('notification-panel')?.classList.add('hidden');
    return;
  }

  loadCurrentProfile(session.user.id);
  loadNotifications();
  subscribeToNotifications(session.user.id);
});

initNotifications();
