(() => {
  const form = document.getElementById('login-form');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const message = document.getElementById('message');
  const loginButton = document.getElementById('login-button');
  const signinButton = document.getElementById('signin-button');
  const togglePassword = document.getElementById('toggle-password');

  function showMessage(text, type = 'error') {
    message.textContent = text;
    message.className = text ? `message ${type}` : 'message';
  }

  function setBusy(busy) {
    loginButton.disabled = busy;
    signinButton.disabled = busy;
    loginButton.textContent = busy ? 'Signing in...' : 'Login';
  }

  function getSignInError(error) {
    if (error?.code === 'invalid_credentials') {
      return 'Email or password is incorrect. Check your Supabase Auth user and password, or reset the password in Supabase.';
    }
    if (error?.code === 'email_not_confirmed') {
      return 'Confirm this email address in Supabase Authentication before signing in.';
    }
    if (error?.name === 'TypeError' || /fetch|network/i.test(error?.message || '')) {
      return 'Could not reach Supabase. Check your internet connection and project URL, then try again.';
    }
    return error?.message || 'Unable to sign in. Check your details and try again.';
  }

  if (togglePassword) {
    togglePassword.addEventListener('click', () => {
      const show = passwordInput.type === 'password';
      passwordInput.type = show ? 'text' : 'password';
      togglePassword.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
  }

  async function signIn(event) {
    event.preventDefault();
    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;

    if (!email || !password) {
      showMessage('Please enter both your email address and password.');
      (!email ? emailInput : passwordInput).focus();
      return;
    }
    if (!emailInput.checkValidity()) {
      showMessage('Please enter a valid email address.');
      emailInput.focus();
      return;
    }
    if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY
      || window.SUPABASE_URL.startsWith('YOUR_')
      || window.SUPABASE_ANON_KEY.startsWith('YOUR_')) {
      showMessage('Supabase is not configured. Check the project URL and anon/publishable key in js/config.js.');
      return;
    }
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      showMessage('The Supabase authentication library did not load. Check your internet connection and reload.');
      return;
    }

    setBusy(true);
    showMessage('');
    try {
      const client = window.supabase.createClient(
        window.SUPABASE_URL,
        window.SUPABASE_ANON_KEY
      );
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.user) throw new Error('Supabase sign-in completed without returning a user.');

      const { data: profile, error: profileError } = await client
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .maybeSingle();
      if (profileError) {
        throw new Error(`Signed in, but could not read your role profile: ${profileError.message}`);
      }
      if (!profile?.role) {
        await client.auth.signOut();
        throw new Error('Sign-in succeeded, but this Auth user has no public.profiles row. Add a profile with the same Auth UID and role staff or admin.');
      }

      const role = String(profile.role).trim().toLowerCase();
      if (role === 'scholar' || role === 'student') {
        window.location.href = 'scholar-dashboard.html';
      } else if (role === 'staff' || role === 'admin') {
        window.location.href = 'staff-dashboard.html';
      } else {
        await client.auth.signOut();
        throw new Error(`Sign-in succeeded, but the profile role "${profile.role}" is not supported. Use scholar, staff, or admin.`);
      }
    } catch (error) {
      showMessage(getSignInError(error));
    } finally {
      setBusy(false);
    }
  }

  form.addEventListener('submit', signIn);
  signinButton.addEventListener('click', signIn);
})();
