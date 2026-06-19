// GET /auth/reset?token=X. Clicked from the password reset email. Shows a
// new-password form (doesn't consume the token yet, that happens when the
// form is actually submitted to POST /api/auth/reset).

function invalidPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset link invalid | MyJay.net</title>
  <meta name="robots" content="noindex">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@1,300&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@300;400;500&display=swap" rel="stylesheet">
  <link rel="icon" type="image/png" href="/assets/img/favicon.png">
  <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
  <header class="torn-header compact">
    <div class="logo">
      <img src="/assets/img/logo.png" alt="MyJay.net" onerror="var s=this.nextElementSibling; this.remove(); s.style.display=''">
      <span class="logo-fallback" style="display:none"><span class="myjay">MyJay</span><span class="dotnet">.net</span></span>
    </div>
  </header>
  <main class="wrapper">
    <section class="auth-section">
      <h1>That link didn't work.</h1>
      <p class="text-muted">It may have expired (links last 1 hour) or already been used. Request a new one from the login page.</p>
      <a class="btn mt-1" href="/login">Back to login →</a>
    </section>
  </main>
  <footer class="footer">
    <span class="footnote">[2] v0.1.0-alpha, independently run.</span>
  </footer>
  <script type="module" src="/assets/main.js"></script>
</body>
</html>`;
}

function formPage(token) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset your password | MyJay.net</title>
  <meta name="robots" content="noindex">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@1,300&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@300;400;500&display=swap" rel="stylesheet">
  <link rel="icon" type="image/png" href="/assets/img/favicon.png">
  <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
  <header class="torn-header compact">
    <div class="logo">
      <img src="/assets/img/logo.png" alt="MyJay.net" onerror="var s=this.nextElementSibling; this.remove(); s.style.display=''">
      <span class="logo-fallback" style="display:none"><span class="myjay">MyJay</span><span class="dotnet">.net</span></span>
    </div>
  </header>
  <main class="wrapper">
    <section class="auth-section">
      <h1>Set a new password.</h1>
      <div class="card">
        <form id="reset-form" novalidate>
          <div class="form-error" id="form-error"></div>
          <div class="field">
            <label for="password">New password</label>
            <input type="password" id="password" autocomplete="new-password" required minlength="8">
            <p class="field-hint">At least 8 characters.</p>
          </div>
          <div class="field">
            <label for="confirm">Confirm password</label>
            <input type="password" id="confirm" autocomplete="new-password" required minlength="8">
          </div>
          <button type="submit" class="btn" id="submit-btn">Set new password →</button>
        </form>
      </div>
    </section>
  </main>
  <footer class="footer">
    <span class="footnote">[2] v0.1.0-alpha, independently run.</span>
  </footer>
  <script type="module" src="/assets/main.js"></script>
  <script type="module">
    import { apiFetch, setFieldError, clearFieldError, clearFormErrors } from '/assets/main.js';

    const token = ${JSON.stringify(token)};
    const passwordInput = document.getElementById('password');
    const confirmInput = document.getElementById('confirm');
    const form = document.getElementById('reset-form');
    const errorEl = document.getElementById('form-error');
    const submitBtn = document.getElementById('submit-btn');

    [passwordInput, confirmInput].forEach((input) => {
      input.addEventListener('input', () => clearFieldError(input));
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      clearFormErrors(form);

      if (passwordInput.value.length < 8) {
        setFieldError(passwordInput, 'Password must be at least 8 characters.');
        passwordInput.focus();
        return;
      }
      if (confirmInput.value !== passwordInput.value) {
        setFieldError(confirmInput, "Passwords don't match.");
        confirmInput.focus();
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving...';

      try {
        const res = await apiFetch('/api/auth/reset', {
          method: 'POST',
          body: JSON.stringify({ token, password: passwordInput.value }),
        });
        const data = await res.json();
        if (!res.ok) {
          errorEl.textContent = data.error || 'Something went wrong.';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Set new password →';
          return;
        }
        document.querySelector('.auth-section').innerHTML =
          '<h1>Password updated.</h1><p class="text-muted">You can log in with your new password now.</p><a class="btn mt-1" href="/login">Log in →</a>';
      } catch {
        errorEl.textContent = 'Network error. Please try again.';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Set new password →';
      }
    });
  </script>
</body>
</html>`;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const token = new URL(request.url).searchParams.get('token') || '';

  const userId = token ? await env.SESSIONS.get(`reset:${token}`) : null;
  if (!userId) {
    return new Response(invalidPage(), { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  return new Response(formPage(token), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
