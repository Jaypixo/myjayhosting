// MyJay shared client utilities: nav auth state, API helpers, announcement banner.

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
  const authEl = document.querySelector('[data-nav-auth]');
  if (!authEl) return;
  const user = await getCurrentUser();
  if (user) {
    authEl.innerHTML = '';
    const link = document.createElement('a');
    link.className = 'btn btn-sm';
    link.href = '/dashboard.html';
    link.textContent = `Dashboard (${user.username})`;
    authEl.appendChild(link);
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
    // decorative, whatever, ignore failures
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initAnnouncement();
});
