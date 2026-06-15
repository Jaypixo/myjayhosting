// MyJay shared client utilities — status bar uptime, nav auth state, API helpers.

const LAUNCH_DATE = new Date('2025-01-01T00:00:00Z');

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatUptime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function initUptime() {
  const el = document.querySelector('[data-uptime]');
  if (!el) return;
  const tick = () => {
    el.textContent = `uptime ${formatUptime(Date.now() - LAUNCH_DATE.getTime())}`;
  };
  tick();
  setInterval(tick, 1000);
}

export async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(path, { ...options, headers, credentials: 'same-origin' });
}

export async function getCurrentUser() {
  try {
    const res = await apiFetch('/api/user/me');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function logout() {
  await apiFetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
}

async function initNav() {
  const loginLink = document.querySelector('[data-nav-auth]');
  if (!loginLink) return;
  const user = await getCurrentUser();
  if (user) {
    loginLink.textContent = `Dashboard (${user.username})`;
    loginLink.setAttribute('href', '/dashboard.html');
  }
}

async function initAnnouncement() {
  try {
    const res = await apiFetch('/api/settings');
    if (!res.ok) return;
    const settings = await res.json();
    if (!settings.announcementEnabled || !settings.announcement) return;
    if (sessionStorage.getItem('myjay-announcement-dismissed') === settings.announcement) return;

    const banner = document.createElement('div');
    banner.className = 'announcement-banner';

    const text = document.createElement('span');
    text.textContent = settings.announcement;
    banner.appendChild(text);

    const close = document.createElement('button');
    close.textContent = '✕';
    close.setAttribute('aria-label', 'Dismiss');
    close.addEventListener('click', () => {
      banner.remove();
      sessionStorage.setItem('myjay-announcement-dismissed', settings.announcement);
    });
    banner.appendChild(close);

    document.body.insertBefore(banner, document.body.firstChild);
  } catch {
    // decorative — ignore failures
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initUptime();
  initNav();
  initAnnouncement();
});
