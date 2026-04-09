// home.js – landing page login logic
import { db, auth, doc, getDoc } from '../firebase.js';

const DESTINATIONS = {
  chem: 'chem/chem.html',
  training: 'Training/training.html',
  supervisor: 'chem/chem.html#supervisorDashboard'
};

let pendingTarget = null;
let currentRole = 'lifeguard';
let employeesCache = [];
const ROLE_STORAGE_KEY = 'chemlogRole';

const modal = document.getElementById('homeLoginModal');
const closeBtn = document.getElementById('homeLoginClose');
const form = document.getElementById('homeLoginForm');
const usernameInput = document.getElementById('homeUsernameInput');
const passwordInput = document.getElementById('homePasswordInput');
const usernameLabel = document.getElementById('homeUsernameLabel');
const passwordLabel = document.getElementById('homePasswordLabel');
const messageEl = document.getElementById('homeLoginMessage');
const roleToggle = document.getElementById('roleToggle');

function footerLogoPrefix() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const lastDir = parts.length > 1 ? parts[parts.length - 2] : '';
  return ['Main', 'main'].includes(lastDir) ? '../' : '';
}

function mountUnifiedFooter() {
  const prefix = footerLogoPrefix();
  document.querySelectorAll('.footer').forEach((footer) => {
    if (footer.dataset.unifiedFooter === 'true') return;
    footer.innerHTML = `
      <div class="site-footer-meta">
        <img src="${prefix}Images/Logos/logo.png" alt="PoolPro logo" class="site-footer-logo">
        <span class="site-footer-divider" aria-hidden="true"></span>
        <div class="site-footer-copy">
          <div class="site-footer-title">PoolPro v3.1</div>
          <div class="site-footer-date">Published April 2026</div>
        </div>
      </div>
    `;
    footer.dataset.unifiedFooter = 'true';
  });
}

function setRole(role) {
  currentRole = role;

  try {
    localStorage.setItem(ROLE_STORAGE_KEY, role);
  } catch (err) {
    console.warn('Could not persist selected role on home page:', err);
  }

  const options = roleToggle.querySelectorAll('.theme-toggle-option');
  options.forEach((opt) => {
    opt.classList.toggle('active', opt.dataset.role === role);
  });

  const thumb = document.getElementById('roleToggleThumb');
  if (thumb) {
    thumb.style.transform = role === 'lifeguard' ? 'translateX(0%)' : 'translateX(100%)';
  }

  
  const passwordGroup = document.getElementById('homePasswordGroup');
  if (role === 'lifeguard') {
    usernameLabel.textContent = 'Email';
    usernameInput.type = 'email';
    if (passwordGroup) passwordGroup.style.display = 'none';
  } else {
    usernameLabel.textContent = 'Email';
    usernameInput.type = 'email';
    passwordLabel.textContent = 'Password';
    passwordInput.type = 'password';
    if (passwordGroup) passwordGroup.style.display = '';
  }

  if (messageEl) {
    messageEl.textContent = '';
    messageEl.classList.remove('error');
  }
}

function openModal(target) {
  pendingTarget = target;

  // Force role based on which button was clicked; hide the toggle entirely
  const isSupervisorEntry = target === 'supervisor';
  setRole(isSupervisorEntry ? 'supervisor' : 'lifeguard');
  roleToggle.style.display = 'none';

  modal.style.display = 'block';
  requestAnimationFrame(() => modal.classList.add('visible'));

  usernameInput.value = '';
  passwordInput.value = '';
  usernameInput.focus();
}

function closeModal() {
  modal.classList.remove('visible');
  setTimeout(() => {
    modal.style.display = 'none';
  }, 200);
  pendingTarget = null;
}

const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;

async function authenticateLifeguard(emailRaw) {
  const trimmedEmail = (emailRaw || '').trim().toLowerCase();
  if (!trimmedEmail || !trimmedEmail.includes('@')) {
    throw new Error('Please enter a valid email address.');
  }

  const employees = Array.isArray(employeesCache) ? employeesCache : [];
  const match = employees.find(
    (emp) => (emp.email || emp.id || '').toString().trim().toLowerCase() === trimmedEmail
  );
  if (!match) {
    throw new Error('Email not found. Please contact your supervisor.');
  }

  // Check 10-day re-auth window
  try {
    const lastAuth = localStorage.getItem('chemlogLastEmailAuth');
    const lastEmail = localStorage.getItem('chemlogEmailAuthUser');
    if (lastAuth && lastEmail === trimmedEmail && (Date.now() - parseInt(lastAuth)) < TEN_DAYS_MS) {
      // Within window — proceed without email link
      sessionStorage.setItem('chemlogRole', 'lifeguard');
      sessionStorage.setItem('chemlogEmployeeEmail', trimmedEmail);
      localStorage.setItem(ROLE_STORAGE_KEY, 'lifeguard');
      localStorage.removeItem('loginToken');
      localStorage.removeItem('ChemLogSupervisor');
      localStorage.removeItem('trainingSupervisorLoggedIn');
      localStorage.removeItem('training_supervisor_logged_in_v1');
      return match;
    }
  } catch (_) {}

  // Send Firebase email sign-in link
  const { sendSignInLinkToEmail } = await import('https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js');
  const actionCodeSettings = {
    url: window.location.origin + window.location.pathname,
    handleCodeInApp: true,
  };
  localStorage.setItem('chemlogEmailForSignIn', trimmedEmail);
  localStorage.setItem('chemlogEmailLinkTarget', pendingTarget || 'chem');
  await sendSignInLinkToEmail(auth, trimmedEmail, actionCodeSettings);

  throw new Error('__EMAIL_LINK_SENT__');
}

function markSupervisorLoggedIn(email) {
  try {
    localStorage.setItem('trainingSupervisorLoggedIn', 'true');
    localStorage.setItem('training_supervisor_logged_in_v1', 'true');
    localStorage.setItem('ChemLogSupervisor', 'true');
    const expires = Date.now() + 10 * 24 * 60 * 60 * 1000;
    localStorage.setItem('loginToken', JSON.stringify({ username: email || 'supervisor', expires }));
    localStorage.setItem(ROLE_STORAGE_KEY, 'supervisor');
  } catch (err) {
    console.warn('Could not persist supervisor login flags', err);
  }
}

async function authenticateSupervisor(email, password) {
  const e = (email || '').trim();
  const p = password || '';

  if (!e || !p) throw new Error('Please enter your email and password.');

  if (window.supervisorSignIn) {
    await window.supervisorSignIn(e, p);
  } else {
    const { signInWithEmailAndPassword: fbSignIn } = await import('https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js');
    await fbSignIn(auth, e, p);
    markSupervisorLoggedIn(e);
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  messageEl.textContent = '';
  messageEl.classList.remove('error');

  try {
    if (currentRole === 'lifeguard') {
      await authenticateLifeguard(usernameInput.value);
    } else {
      await authenticateSupervisor(usernameInput.value, passwordInput.value);
    }

    const path = pendingTarget ? DESTINATIONS[pendingTarget] : DESTINATIONS.chem;
    closeModal();
    window.location.href = path;
  } catch (err) {
    if (err.message === '__EMAIL_LINK_SENT__') {
      messageEl.textContent = 'A sign-in link has been sent to your email. Please check your inbox and click the link to continue.';
      messageEl.classList.remove('error');
      return;
    }
    console.error('Home login failed:', err);
    const code = err.code || '';
    const friendly = code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential'
      ? 'Incorrect email or password.' : (err.message || 'Login failed. Please try again.');
    messageEl.textContent = friendly;
    messageEl.classList.add('error');
  }
}

async function handleEmailLinkCallback() {
  try {
    const { isSignInWithEmailLink, signInWithEmailLink } = await import('https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js');
    if (!isSignInWithEmailLink(auth, window.location.href)) return false;

    let email = '';
    try { email = localStorage.getItem('chemlogEmailForSignIn') || ''; } catch (_) {}
    if (!email) {
      email = window.prompt('Please re-enter your email to complete sign-in:') || '';
    }
    if (!email) return false;

    await signInWithEmailLink(auth, email, window.location.href);

    try {
      localStorage.setItem('chemlogLastEmailAuth', Date.now().toString());
      localStorage.setItem('chemlogEmailAuthUser', email.toLowerCase());
      localStorage.removeItem('chemlogEmailForSignIn');
    } catch (_) {}

    sessionStorage.setItem('chemlogRole', 'lifeguard');
    sessionStorage.setItem('chemlogEmployeeEmail', email.toLowerCase());
    localStorage.setItem(ROLE_STORAGE_KEY, 'lifeguard');

    let target = 'chem';
    try { target = localStorage.getItem('chemlogEmailLinkTarget') || 'chem'; localStorage.removeItem('chemlogEmailLinkTarget'); } catch (_) {}

    // Strip the email link params from the URL then navigate
    window.history.replaceState({}, document.title, window.location.pathname);
    window.location.href = DESTINATIONS[target] || DESTINATIONS.chem;
    return true;
  } catch (err) {
    console.error('Email link sign-in error:', err);
    return false;
  }
}

async function loadEmployees() {
  try {
    const ref = doc(db, 'settings', 'employees');
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      const raw = Array.isArray(data.employees) ? data.employees : [];
      employeesCache = raw.map((e) => ({
        id: (e.id ?? '').toString().trim(),
        email: (e.email ?? e.id ?? '').toString().trim().toLowerCase(),
        firstName: (e.firstName ?? '').toString().trim(),
        lastName: (e.lastName ?? '').toString().trim(),
      }));
    }
  } catch (err) {
    console.error('Failed to load employees:', err);
  }
}

function wireMenu() {
  document.querySelectorAll('.home-menu-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      openModal(target);
    });
  });
}

function wireRoleToggle() {
  if (!roleToggle) return;
  roleToggle.addEventListener('click', (event) => {
    const btn = event.target.closest('.theme-toggle-option');
    if (!btn) return;
    setRole(btn.dataset.role);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const handledLink = await handleEmailLinkCallback();
  if (handledLink) return;

  mountUnifiedFooter();
  loadEmployees();
  wireMenu();
  wireRoleToggle();

  form.addEventListener('submit', handleSubmit);
  closeBtn.addEventListener('click', closeModal);

  let initialRole = 'lifeguard';
  try {
    const stored = localStorage.getItem(ROLE_STORAGE_KEY);
    if (stored === 'supervisor' || stored === 'lifeguard') {
      initialRole = stored;
    }
  } catch (err) {
    console.warn('Could not read stored role; defaulting to lifeguard', err);
  }

  setRole(initialRole);
});

window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});
