// MyJay shared client utilities: nav auth state, API helpers, modal dialogs,
// and inline form field errors.

// ── Modal dialogs (replace native alert/confirm/prompt everywhere) ─────────

function buildModal({ title, message, danger = false, body }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const box = document.createElement('div');
  box.className = danger ? 'modal-box modal-danger' : 'modal-box';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');

  if (title) {
    const h = document.createElement('h3');
    h.className = 'modal-title';
    h.textContent = title;
    box.appendChild(h);
  }

  if (message) {
    const p = document.createElement('p');
    p.className = 'modal-message';
    p.textContent = message;
    box.appendChild(p);
  }

  if (body) box.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  box.appendChild(actions);

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  return { overlay, actions };
}

// Escape always cancels/dismisses. Clicking the dimmed backdrop does too,
// it never triggers the destructive action, only an explicit button click does.
function attachDismiss(overlay, onDismiss) {
  function onKeydown(e) {
    if (e.key === 'Escape') onDismiss();
  }
  function onClick(e) {
    if (e.target === overlay) onDismiss();
  }
  document.addEventListener('keydown', onKeydown);
  overlay.addEventListener('click', onClick);
  return () => document.removeEventListener('keydown', onKeydown);
}

export function showAlert(message, { title = 'Notice' } = {}) {
  return new Promise((resolve) => {
    const { overlay, actions } = buildModal({ title, message });

    const okBtn = document.createElement('button');
    okBtn.className = 'btn btn-sm';
    okBtn.textContent = 'OK';
    actions.appendChild(okBtn);

    function finish() {
      detach();
      overlay.remove();
      resolve();
    }

    const detach = attachDismiss(overlay, finish);
    okBtn.addEventListener('click', finish);
    okBtn.focus();
  });
}

export function showConfirm(message, { title = 'Are you sure?', confirmText = 'Confirm', cancelText = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const { overlay, actions } = buildModal({ title, message, danger });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-ghost btn-sm';
    cancelBtn.textContent = cancelText;

    const confirmBtn = document.createElement('button');
    confirmBtn.className = danger ? 'btn btn-danger btn-sm' : 'btn btn-sm';
    confirmBtn.textContent = confirmText;

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);

    function finish(result) {
      detach();
      overlay.remove();
      resolve(result);
    }

    const detach = attachDismiss(overlay, () => finish(false));
    cancelBtn.addEventListener('click', () => finish(false));
    confirmBtn.addEventListener('click', () => finish(true));
    confirmBtn.focus();
  });
}

export function showPrompt(message, { title = 'Input needed', placeholder = '', defaultValue = '' } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'modal-input';
    input.placeholder = placeholder;
    input.value = defaultValue;

    const { overlay, actions } = buildModal({ title, message, body: input });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-ghost btn-sm';
    cancelBtn.textContent = 'Cancel';

    const okBtn = document.createElement('button');
    okBtn.className = 'btn btn-sm';
    okBtn.textContent = 'OK';

    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);

    function finish(result) {
      detach();
      overlay.remove();
      resolve(result);
    }

    const detach = attachDismiss(overlay, () => finish(null));
    cancelBtn.addEventListener('click', () => finish(null));
    okBtn.addEventListener('click', () => finish(input.value.trim() || null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(input.value.trim() || null);
    });
    input.focus();
  });
}

// ── Inline field errors (replace native "fill out this field" bubbles) ─────

export function setFieldError(input, message) {
  const field = input.closest('.field') || input.parentElement;
  field.classList.add('field-invalid');
  let err = field.querySelector('.field-error');
  if (!err) {
    err = document.createElement('p');
    err.className = 'field-error';
    field.appendChild(err);
  }
  err.textContent = message;
}

export function clearFieldError(input) {
  const field = input.closest('.field') || input.parentElement;
  field.classList.remove('field-invalid');
  const err = field.querySelector('.field-error');
  if (err) err.remove();
}

export function clearFormErrors(form) {
  form.querySelectorAll('.field-invalid').forEach((f) => f.classList.remove('field-invalid'));
  form.querySelectorAll('.field-error').forEach((e) => e.remove());
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
  const authEl = document.querySelector('[data-nav-auth]');
  if (!authEl) return;
  const user = await getCurrentUser();
  if (user) {
    authEl.innerHTML = '';
    const link = document.createElement('a');
    link.className = 'btn btn-sm';
    link.href = '/dashboard';
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
