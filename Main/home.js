// home.js – landing page login logic
import { db, auth, doc, getDoc, setDoc, getDocs, collection } from '../firebase.js';
import { requireUserAgreement } from '../agreement.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendEmailVerification,
  sendPasswordResetEmail,
  applyActionCode
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';

const DESTINATIONS = {
  chem: 'chem/chem.html',
  training: 'Training/training.html',
  duties: 'duties/duties.html',
  operational: 'operational/operational.html',
  resources: 'resources/resources.html',
  supervisor: 'chem/chem.html#supervisorDashboard'
};

const ROLE_STORAGE_KEY = 'chemlogRole';
const VERIFY_CONTEXT_KEY = 'poolproPendingLifeguardVerification';
const VERIFY_WINDOW_MS = 5 * 60 * 60 * 1000;
const LIFEGUARD_SESSION_KEY = 'poolproLifeguardSession';
const LIFEGUARD_SESSION_VERIFICATION_VERSION = 1;
const VERIFY_EMAIL_RESEND_MS = 60 * 1000;
const ALLOWED_PASSWORD_CHARS = /^[A-Za-z0-9!@#$%^&*()_\-+=[\]{};:'",.<>/?\\|`~]+$/;
const EMAIL_AUTH_MODE_VERIFY = 'verifyEmail';
const DEVICE_VERIFIED_KEY = 'poolproDeviceVerified';
const LOGIN_ATTEMPT_STORAGE_KEY = 'poolproLoginAttempts';
const MAX_LOGIN_ATTEMPTS = 6;
const LOGIN_ATTEMPT_LOCKOUT_MS = 15 * 60 * 1000;

let pendingTarget = null;
let currentRole = 'lifeguard';
let currentView = 'login';
let employeesCache = [];
let employeeDocSnapshot = [];
let homePoolOptions = [];
let pendingVerification = null;
let verifyCooldownUntil = 0;
let verifyCooldownTimer = null;
let verifyStatusPoller = null;
let createAccountSubmitting = false;

const modal = document.getElementById('homeLoginModal');
const closeBtn = document.getElementById('homeLoginClose');
const modalTitle = document.getElementById('homeModalTitle');
const form = document.getElementById('homeLoginForm');
const createAccountForm = document.getElementById('homeCreateAccountForm');
const verifyForm = document.getElementById('homeVerifyForm');
const usernameInput = document.getElementById('homeUsernameInput');
const passwordInput = document.getElementById('homePasswordInput');
const usernameLabel = document.getElementById('homeUsernameLabel');
const passwordLabel = document.getElementById('homePasswordLabel');
const messageEl = document.getElementById('homeLoginMessage');
const createMessageEl = document.getElementById('homeCreateAccountMessage');
const verifyMessageEl = document.getElementById('homeVerifyMessage');
const verifySubtitleEl = document.getElementById('homeVerifySubtitle');
const verifyHintEl = document.getElementById('homeVerifyHint');
const verifyResendBtn = document.getElementById('homeVerifyResendBtn');
const verifyCooldownText = document.getElementById('homeVerifyCooldownText');
const verifyBackBtn = document.getElementById('homeVerifyBackBtn');
const roleToggle = document.getElementById('roleToggle');
const showCreateAccountBtn = document.getElementById('homeShowCreateAccountBtn');
const firstTimeCallout = document.getElementById('homeFirstTimeCallout');
const forgotPasswordBtn = document.getElementById('homeForgotPasswordBtn');
const backToLoginBtn = document.getElementById('homeBackToLoginBtn');
const resetPasswordForm = document.getElementById('homeResetPasswordForm');
const resetMessageEl = document.getElementById('homeResetMessage');
const resetFieldInput = document.getElementById('homeResetFieldInput');
const resetFieldLabel = document.getElementById('homeResetFieldLabel');
const resetCopyEl = document.getElementById('homeResetCopy');
const resetBackBtn = document.getElementById('homeResetBackBtn');
const createUsernameInput = document.getElementById('homeCreateUsernameInput');
const createFirstNameInput = document.getElementById('homeCreateFirstNameInput');
const createLastNameInput = document.getElementById('homeCreateLastNameInput');
const createEmailInput = document.getElementById('homeCreateEmailInput');
const createPhoneInput = document.getElementById('homeCreatePhoneInput');
const createPoolInput = document.getElementById('homeCreatePoolInput');
const createPasswordInput = document.getElementById('homeCreatePasswordInput');
const createConfirmPasswordInput = document.getElementById('homeCreateConfirmPasswordInput');
const createSubmitBtn = document.getElementById('homeCreateAccountSubmit');

function markDeviceVerified(email) {
  if (!email) return;
  try {
    const key = DEVICE_VERIFIED_KEY;
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    const normalized = email.trim().toLowerCase();
    if (!list.includes(normalized)) {
      list.push(normalized);
      localStorage.setItem(key, JSON.stringify(list));
    }
  } catch (_) {}
}

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

function normalizeUsername(raw) {
  return (raw || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9._-]/g, '');
}

function normalizePhoneDigits(raw) {
  return (raw || '').replace(/\D/g, '');
}

function normalizePhoneE164(raw) {
  const digits = normalizePhoneDigits(raw);
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
}

function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  if (!local || !domain) return email || '';
  const visible = local.length <= 2 ? local[0] || '*' : `${local[0]}${'*'.repeat(Math.max(1, local.length - 2))}${local.slice(-1)}`;
  return `${visible}@${domain}`;
}

function maskPhone(phone) {
  const digits = normalizePhoneDigits(phone);
  if (digits.length < 4) return phone || '';
  return `(***) ***-${digits.slice(-4)}`;
}

function normalizeEmployeeRecord(rawEmployee) {
  const employee = rawEmployee || {};
  const legacyId = (employee.id ?? '').toString().trim();
  const emailSource = employee.email ?? (legacyId.includes('@') ? legacyId : '');
  const email = emailSource.toString().trim().toLowerCase();
  return {
    ...employee,
    id: email || legacyId,
    email,
    username: normalizeUsername(employee.username || ''),
    firstName: (employee.firstName ?? '').toString().trim(),
    lastName: (employee.lastName ?? '').toString().trim(),
    homePool: (employee.homePool ?? '').toString().trim(),
    phone: normalizePhoneDigits(employee.phone ?? ''),
  };
}

function getAuthEmail(account) {
  return (account?.authEmail || account?.employeeEmail || '').toString().trim().toLowerCase();
}

function buildEmployeeFromAccount(account) {
  return normalizeEmployeeRecord({
    email: account?.employeeEmail || account?.authEmail || '',
    id: account?.employeeEmail || account?.authEmail || '',
    username: account?.username || '',
    firstName: account?.firstName || '',
    lastName: account?.lastName || '',
    homePool: account?.homePool || '',
    phone: account?.phone || '',
  });
}

function savePendingVerificationContext(context) {
  try {
    localStorage.setItem(VERIFY_CONTEXT_KEY, JSON.stringify(context));
  } catch (_) { /* ignore */ }
}

function loadPendingVerificationContext() {
  try {
    const raw = localStorage.getItem(VERIFY_CONTEXT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function clearPendingVerificationContext() {
  try {
    localStorage.removeItem(VERIFY_CONTEXT_KEY);
  } catch (_) { /* ignore */ }
}

function getLoginAttemptStorage() {
  try {
    const raw = localStorage.getItem(LOGIN_ATTEMPT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function saveLoginAttemptStorage(store) {
  try {
    localStorage.setItem(LOGIN_ATTEMPT_STORAGE_KEY, JSON.stringify(store || {}));
  } catch (_) { /* ignore */ }
}

function normalizeLoginAttemptIdentifier(identifier) {
  return String(identifier || '').trim().toLowerCase();
}

function getLoginAttemptKey(role, identifier) {
  const normalizedIdentifier = normalizeLoginAttemptIdentifier(identifier);
  return normalizedIdentifier ? `${role}:${normalizedIdentifier}` : '';
}

function formatLoginLockoutMessage(waitMs) {
  const remainingMinutes = Math.max(1, Math.ceil(Number(waitMs || 0) / 60000));
  return `Too many login attempts. Wait ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}, then try again.`;
}

function createLoginLockoutError(waitMs) {
  const err = new Error(formatLoginLockoutMessage(waitMs));
  err.code = 'poolpro/too-many-login-attempts';
  return err;
}

function getLoginAttemptState(role, identifier) {
  const key = getLoginAttemptKey(role, identifier);
  const store = getLoginAttemptStorage();
  if (!key) {
    return { key: '', store, count: 0, lastFailedAt: 0, blockedUntil: 0 };
  }

  const rawState = store[key] || {};
  const now = Date.now();
  const count = Number(rawState.count || 0);
  const lastFailedAt = Number(rawState.lastFailedAt || 0);
  const blockedUntil = Number(rawState.blockedUntil || 0);
  const shouldReset =
    !count ||
    (blockedUntil && now >= blockedUntil) ||
    (lastFailedAt && (now - lastFailedAt) >= LOGIN_ATTEMPT_LOCKOUT_MS);

  if (shouldReset) {
    delete store[key];
    saveLoginAttemptStorage(store);
    return { key, store, count: 0, lastFailedAt: 0, blockedUntil: 0 };
  }

  return { key, store, count, lastFailedAt, blockedUntil };
}

function assertLoginAttemptsRemaining(role, identifier) {
  const state = getLoginAttemptState(role, identifier);
  if (!state.key) return;

  const now = Date.now();
  if (state.blockedUntil && state.blockedUntil > now) {
    throw createLoginLockoutError(state.blockedUntil - now);
  }
}

function recordLoginFailure(role, identifier, options = {}) {
  const { lockImmediately = false } = options;
  const state = getLoginAttemptState(role, identifier);
  if (!state.key) {
    return { count: 0, lastFailedAt: 0, blockedUntil: 0 };
  }

  const now = Date.now();
  const nextCount = lockImmediately ? MAX_LOGIN_ATTEMPTS : (Number(state.count || 0) + 1);
  const blockedUntil = nextCount >= MAX_LOGIN_ATTEMPTS ? now + LOGIN_ATTEMPT_LOCKOUT_MS : 0;
  state.store[state.key] = {
    count: nextCount,
    lastFailedAt: now,
    blockedUntil,
  };
  saveLoginAttemptStorage(state.store);
  return state.store[state.key];
}

function clearLoginFailures(role, identifier) {
  const state = getLoginAttemptState(role, identifier);
  if (!state.key || !state.store[state.key]) return;
  delete state.store[state.key];
  saveLoginAttemptStorage(state.store);
}

function sanitizeTarget(target) {
  const candidate = String(target || '').trim();
  if (!candidate) return DESTINATIONS.chem;
  return Object.values(DESTINATIONS).includes(candidate) ? candidate : DESTINATIONS.chem;
}

function targetKeyFromDestinationPath(target) {
  const sanitized = sanitizeTarget(target);
  const entry = Object.entries(DESTINATIONS).find(([, path]) => path === sanitized);
  return entry?.[0] === 'supervisor' ? 'chem' : (entry?.[0] || 'chem');
}

function buildVerificationActionUrl({ username, target, emailAuthMode }) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('username', normalizeUsername(username));
  url.searchParams.set('target', sanitizeTarget(target));
  if (emailAuthMode) url.searchParams.set('authMode', emailAuthMode);
  return url.toString();
}

function stopVerifyCooldownTimer() {
  if (verifyCooldownTimer) {
    clearInterval(verifyCooldownTimer);
    verifyCooldownTimer = null;
  }
}

function stopVerifyStatusPoller() {
  if (verifyStatusPoller) {
    clearInterval(verifyStatusPoller);
    verifyStatusPoller = null;
  }
}

function updateVerifyCooldownUi() {
  const remainingMs = Math.max(0, verifyCooldownUntil - Date.now());
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const coolingDown = remainingMs > 0;

  if (verifyResendBtn) verifyResendBtn.disabled = coolingDown;
  if (verifyCooldownText) {
    verifyCooldownText.textContent = coolingDown
      ? `Resend available in ${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'}.`
      : '';
  }

  if (!coolingDown) {
    stopVerifyCooldownTimer();
  }
}

function startVerifyCooldown() {
  verifyCooldownUntil = Date.now() + VERIFY_EMAIL_RESEND_MS;
  updateVerifyCooldownUi();
  stopVerifyCooldownTimer();
  verifyCooldownTimer = window.setInterval(updateVerifyCooldownUi, 1000);
}

function setMessage(el, text, isError = false) {
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('error', !!text && isError);
}

function setCreateAccountSubmitting(isSubmitting) {
  createAccountSubmitting = isSubmitting;
  if (!createSubmitBtn) return;
  createSubmitBtn.disabled = isSubmitting;
  createSubmitBtn.textContent = isSubmitting ? 'Creating...' : 'Save Info';
}

function clearMessages() {
  setMessage(messageEl, '');
  setMessage(createMessageEl, '');
  setMessage(verifyMessageEl, '');
}

function resetVerificationState() {
  stopVerifyStatusPoller();
  pendingVerification = null;
  if (verifyForm) verifyForm.reset();
  if (verifySubtitleEl) verifySubtitleEl.textContent = '';
  if (verifyHintEl) {
    verifyHintEl.textContent = 'Check spam if it does not arrive within 60 seconds. Use resend if needed.';
  }
  if (verifyResendBtn) verifyResendBtn.textContent = 'Resend Verification';
  verifyCooldownUntil = 0;
  updateVerifyCooldownUi();
  stopVerifyCooldownTimer();
}

function resetForms() {
  form?.reset();
  createAccountForm?.reset();
  verifyForm?.reset();
  resetVerificationState();
  clearMessages();
}

function setModalView(view) {
  currentView = view;
  form?.classList.toggle('hidden', view !== 'login');
  createAccountForm?.classList.toggle('hidden', view !== 'create');
  verifyForm?.classList.toggle('hidden', view !== 'verify');
  resetPasswordForm?.classList.toggle('hidden', view !== 'reset');
  updateFirstTimeCallout();

  if (modalTitle) {
    modalTitle.textContent = view === 'create'
      ? 'Create Account'
      : view === 'verify'
        ? 'Verify Identity'
        : view === 'reset'
          ? 'Reset Password'
          : 'Sign in';
  }

  if (view === 'reset') {
    const isLifeguard = currentRole === 'lifeguard';
    if (resetFieldLabel) resetFieldLabel.textContent = isLifeguard ? 'Username' : 'Email';
    if (resetCopyEl) resetCopyEl.textContent = isLifeguard
      ? 'Enter your username and we\'ll send a password reset link to your registered email.'
      : 'Enter your email address and we\'ll send you a link to reset your password.';
    if (resetFieldInput) {
      resetFieldInput.type = isLifeguard ? 'text' : 'email';
      resetFieldInput.autocomplete = isLifeguard ? 'username' : 'email';
      resetFieldInput.focus();
    }
    setMessage(resetMessageEl, '');
  }

  if (view === 'create') createUsernameInput?.focus();
  if (view === 'verify') verifyResendBtn?.focus();
  if (view === 'login') usernameInput?.focus();
}

function stabilizeHomeModalViewport() {
  if (!modal) return;
  modal.scrollLeft = 0;
  const modalCard = modal.querySelector('.home-login-modal');
  if (modalCard) modalCard.scrollLeft = 0;
}

function setupMobileModalFocusGuards() {
  if (!modal) return;
  modal.querySelectorAll('input, select, button').forEach((control) => {
    control.addEventListener('focus', () => {
      window.setTimeout(() => {
        stabilizeHomeModalViewport();
        control.scrollIntoView({ block: 'center', inline: 'nearest' });
      }, 250);
    });
  });
  window.visualViewport?.addEventListener('resize', stabilizeHomeModalViewport);
  window.addEventListener('orientationchange', () => window.setTimeout(stabilizeHomeModalViewport, 250));
}

function getDestinationPath() {
  return pendingTarget ? DESTINATIONS[pendingTarget] : DESTINATIONS.chem;
}

function populatePoolOptions() {
  if (!createPoolInput) return;
  const currentValue = createPoolInput.value;
  createPoolInput.innerHTML = '<option value="">Select facility</option>';

  const marketMap = {};
  homePoolOptions.forEach((pool) => {
    const market = pool.markets?.[0] || 'Other';
    if (!marketMap[market]) marketMap[market] = [];
    marketMap[market].push(pool.name);
  });

  const listedNames = new Set(homePoolOptions.map((pool) => pool.name));
  const extraNames = employeesCache.map((employee) => employee.homePool).filter((name) => name && !listedNames.has(name));
  if (extraNames.length) {
    if (!marketMap.Other) marketMap.Other = [];
    extraNames.forEach((name) => marketMap.Other.push(name));
  }

  Object.keys(marketMap).sort().forEach((market) => {
    const group = document.createElement('optgroup');
    group.label = market;
    marketMap[market].sort().forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      group.appendChild(option);
    });
    createPoolInput.appendChild(group);
  });

  if (currentValue) createPoolInput.value = currentValue;
}

function persistLifeguardSession(employee, username) {
  const normalizedEmployee = normalizeEmployeeRecord(employee);
  const session = {
    role: 'lifeguard',
    emailVerified: true,
    verificationVersion: LIFEGUARD_SESSION_VERIFICATION_VERSION,
    verifiedAt: new Date().toISOString(),
    email: normalizedEmployee.email || '',
    employeeId: normalizedEmployee.email || normalizedEmployee.id || '',
    username: normalizeUsername(username || normalizedEmployee.username || ''),
    firstName: normalizedEmployee.firstName || '',
    lastName: normalizedEmployee.lastName || '',
    expires: Date.now() + VERIFY_WINDOW_MS,
  };
  sessionStorage.setItem('chemlogRole', 'lifeguard');
  sessionStorage.setItem('chemlogEmployeeEmail', session.email);
  sessionStorage.setItem('chemlogEmployeeId', session.employeeId);
  sessionStorage.setItem('chemlogEmployeeUsername', session.username);
  sessionStorage.setItem('chemlogEmployeeFirstName', session.firstName);
  sessionStorage.setItem('chemlogEmployeeLastName', session.lastName);
  localStorage.setItem(ROLE_STORAGE_KEY, 'lifeguard');
  localStorage.setItem(LIFEGUARD_SESSION_KEY, JSON.stringify(session));
  localStorage.removeItem('loginToken');
  localStorage.removeItem('ChemLogSupervisor');
  localStorage.removeItem('trainingSupervisorLoggedIn');
  localStorage.removeItem('training_supervisor_logged_in_v1');
  localStorage.removeItem('chemlogTrainingSupervisorLoggedIn');
}

function clearLifeguardSession() {
  sessionStorage.removeItem('chemlogRole');
  sessionStorage.removeItem('chemlogEmployeeEmail');
  sessionStorage.removeItem('chemlogEmployeeId');
  sessionStorage.removeItem('chemlogEmployeeUsername');
  sessionStorage.removeItem('chemlogEmployeeFirstName');
  sessionStorage.removeItem('chemlogEmployeeLastName');
  localStorage.removeItem(ROLE_STORAGE_KEY);
  localStorage.removeItem(LIFEGUARD_SESSION_KEY);
}

function getStoredLifeguardSession() {
  try {
    const raw = localStorage.getItem(LIFEGUARD_SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    const expires = Number(session?.expires || 0);
    const hasIdentity = !!(session?.email || session?.employeeId || session?.username);
    const hasVerifiedMarker =
      session?.emailVerified === true &&
      Number(session?.verificationVersion || 0) >= LIFEGUARD_SESSION_VERIFICATION_VERSION &&
      !!session?.verifiedAt;
    if (!hasIdentity || !hasVerifiedMarker || !expires || Date.now() >= expires) {
      clearLifeguardSession();
      return null;
    }
    return session;
  } catch (_) {
    clearLifeguardSession();
    return null;
  }
}

function hasFreshSupervisorSession() {
  try {
    const token = JSON.parse(localStorage.getItem('loginToken') || 'null');
    if (token?.expires && Date.now() < Number(token.expires)) return true;
    if (token?.expires && Date.now() >= Number(token.expires)) clearSupervisorSession();
  } catch (_) {
    return false;
  }
  return false;
}

function clearSupervisorSession() {
  localStorage.removeItem('trainingSupervisorLoggedIn');
  localStorage.removeItem('training_supervisor_logged_in_v1');
  localStorage.removeItem('ChemLogSupervisor');
  localStorage.removeItem('loginToken');
  localStorage.removeItem(ROLE_STORAGE_KEY);
}

function buildLifeguardAgreementContext(account, username) {
  return {
    role: 'lifeguard',
    email: (account?.employeeEmail || account?.authEmail || '').toString().trim().toLowerCase(),
    username: normalizeUsername(username || account?.username || ''),
    firstName: (account?.firstName || '').toString().trim(),
    lastName: (account?.lastName || '').toString().trim(),
    displayName: `${account?.firstName || ''} ${account?.lastName || ''}`.trim(),
    employeeId: (account?.employeeEmail || account?.authEmail || '').toString().trim().toLowerCase(),
  };
}

function buildSupervisorAgreementContext(email) {
  const user = auth.currentUser;
  return {
    role: 'supervisor',
    email: (user?.email || email || '').toString().trim().toLowerCase(),
    username: (user?.email || email || '').toString().trim().toLowerCase(),
    displayName: (user?.displayName || '').toString().trim(),
    employeeId: (user?.email || email || '').toString().trim().toLowerCase(),
  };
}

function setRole(role) {
  currentRole = role;

  try {
    localStorage.setItem(ROLE_STORAGE_KEY, role);
  } catch (err) {
    console.warn('Could not persist selected role on home page:', err);
  }

  const options = roleToggle?.querySelectorAll('.theme-toggle-option') || [];
  options.forEach((opt) => {
    opt.classList.toggle('active', opt.dataset.role === role);
  });

  const thumb = document.getElementById('roleToggleThumb');
  if (thumb) {
    thumb.style.transform = role === 'lifeguard' ? 'translateX(0%)' : 'translateX(100%)';
  }

  if (role === 'lifeguard') {
    usernameLabel.textContent = 'Username';
    usernameInput.type = 'text';
    usernameInput.autocomplete = 'username';
    passwordLabel.textContent = 'Password';
    passwordInput.type = 'password';
    passwordInput.autocomplete = 'current-password';
    showCreateAccountBtn?.classList.remove('hidden');
  } else {
    usernameLabel.textContent = 'Email';
    usernameInput.type = 'email';
    usernameInput.autocomplete = 'email';
    passwordLabel.textContent = 'Password';
    passwordInput.type = 'password';
    passwordInput.autocomplete = 'current-password';
    showCreateAccountBtn?.classList.add('hidden');
    if (currentView !== 'login') setModalView('login');
  }

  updateFirstTimeCallout();
  clearMessages();
}

function updateFirstTimeCallout() {
  if (!firstTimeCallout) return;
  const show = currentView === 'login' && currentRole === 'lifeguard';
  firstTimeCallout.classList.toggle('hidden', !show);
  firstTimeCallout.setAttribute('aria-hidden', show ? 'false' : 'true');
}

function openModal(target) {
  pendingTarget = target;
  const isSupervisorEntry = target === 'supervisor';
  setRole(isSupervisorEntry ? 'supervisor' : 'lifeguard');
  if (roleToggle) roleToggle.style.display = 'none';
  modal.style.display = 'block';
  requestAnimationFrame(() => modal.classList.add('visible'));
  resetForms();
  setModalView('login');
}

function closeModal() {
  modal.classList.remove('visible');
  setTimeout(() => {
    modal.style.display = 'none';
  }, 200);
  pendingTarget = null;
  resetVerificationState();
  clearPendingVerificationContext();
}

function validatePassword(password) {
  if (!password || password.length < 8) return 'Password must be at least 8 characters long.';
  if (!/[0-9]/.test(password)) return 'Password must include at least 1 number.';
  if (!/[!@#$%^&*()_\-+=[\]{};:'",.<>/?\\|`~]/.test(password)) return 'Password must include at least 1 special character.';
  if (!ALLOWED_PASSWORD_CHARS.test(password)) return 'Password can only include letters, numbers, and standard special characters.';
  return '';
}

async function loadEmployees() {
  try {
    const ref = doc(db, 'settings', 'employees');
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      employeeDocSnapshot = [];
      employeesCache = [];
      return;
    }
    const data = snap.data();
    const raw = Array.isArray(data.employees) ? data.employees : [];
    employeeDocSnapshot = raw;
    employeesCache = raw.map(normalizeEmployeeRecord);
  } catch (err) {
    console.error('Failed to load employees:', err);
  }
}

async function loadPools() {
  try {
    const snap = await getDocs(collection(db, 'pools'));
    homePoolOptions = snap.docs
      .map((docSnap) => {
        const data = docSnap.data() || {};
        return {
          name: (data.name || docSnap.id || '').toString().trim(),
          markets: Array.isArray(data.markets) ? data.markets : [],
        };
      })
      .filter((pool) => pool.name);
    populatePoolOptions();
  } catch (err) {
    console.error('Failed to load pools:', err);
  }
}

async function getLifeguardAccount(usernameRaw) {
  const username = normalizeUsername(usernameRaw);
  if (!username) throw new Error('Please enter your username.');
  const accountRef = doc(db, 'lifeguardAccounts', username);
  const accountSnap = await getDoc(accountRef);
  if (!accountSnap.exists()) {
    if (!employeesCache.length) {
      await loadEmployees();
    }

    const matchingEmployee = employeesCache.find((employee) => {
      const normalizedEmployee = normalizeEmployeeRecord(employee);
      const employeeUsername = normalizeUsername(normalizedEmployee.username || '');
      const employeeEmail = (normalizedEmployee.email || '').toLowerCase();
      const emailLocalPart = employeeEmail.includes('@') ? employeeEmail.split('@')[0] : '';
      return employeeUsername === username || employeeEmail === username || emailLocalPart === username;
    });

    if (matchingEmployee?.email) {
      const repairedAccount = {
        username,
        authEmail: matchingEmployee.email,
        employeeEmail: matchingEmployee.email,
        firstName: matchingEmployee.firstName || '',
        lastName: matchingEmployee.lastName || '',
        phone: matchingEmployee.phone || '',
        homePool: matchingEmployee.homePool || '',
        phoneLinked: false,
        repairedFromEmployeesAt: new Date().toISOString(),
      };

      try {
        await setDoc(accountRef, repairedAccount, { merge: true });
      } catch (repairError) {
        console.warn('Could not repair missing lifeguard account from Employees data:', repairError);
      }

      return repairedAccount;
    }

    throw new Error('Username not found. Create an account first, then ask your supervisor for help if the issue persists.');
  }
  return { username, ...accountSnap.data() };
}

async function upsertEmployeeRecord(employee) {
  const normalizedEmployee = normalizeEmployeeRecord(employee);
  const employees = Array.isArray(employeeDocSnapshot) ? [...employeeDocSnapshot] : [];
  const existingIndex = employees.findIndex((entry) => {
    const normalizedEntry = normalizeEmployeeRecord(entry);
    return normalizedEntry.email && normalizedEmployee.email && normalizedEntry.email === normalizedEmployee.email;
  });

  const nextRecord = {
    ...(existingIndex >= 0 ? employees[existingIndex] : {}),
    ...normalizedEmployee,
  };

  if (existingIndex >= 0) employees[existingIndex] = nextRecord;
  else employees.push(nextRecord);

  employeeDocSnapshot = employees;
  employeesCache = employees.map(normalizeEmployeeRecord);
  await setDoc(doc(db, 'settings', 'employees'), { employees }, { merge: true });
}

function buildSignupRecords({ username, firstName, lastName, email, phone, homePool }) {
  const employeeRecord = {
    email,
    id: email,
    username,
    firstName,
    lastName,
    phone,
    homePool,
  };

  const accountData = {
    username,
    authEmail: email,
    employeeEmail: email,
    firstName,
    lastName,
    phone,
    homePool,
    phoneLinked: false,
    createdAt: new Date().toISOString(),
  };

  return { employeeRecord, accountData };
}

async function findLifeguardAccountByEmail(email) {
  const normalizedEmail = (email || '').trim().toLowerCase();
  if (!normalizedEmail) return null;

  const snap = await getDocs(collection(db, 'lifeguardAccounts'));
  let match = null;
  snap.forEach((docSnap) => {
    if (match) return;
    const account = docSnap.data() || {};
    if (getAuthEmail(account) === normalizedEmail) {
      match = {
        username: normalizeUsername(account.username || docSnap.id),
        ...account,
      };
    }
  });
  return match;
}

async function saveSignupRecords(accountRef, accountData, employeeRecord) {
  await Promise.all([
    setDoc(accountRef, accountData, { merge: true }),
    upsertEmployeeRecord(employeeRecord),
  ]);
}

function showSignupVerification(username, accountData, message) {
  openVerificationView({
    username,
    account: accountData,
    target: getDestinationPath(),
    force: true,
    origin: 'create',
  });
  setMessage(verifyMessageEl, message);
}

async function resumeInterruptedSignup({ username, email, password, accountRef, accountData, employeeRecord }) {
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (signInError) {
    const code = signInError.code || '';
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      throw new Error('That email already has an account. Sign in or use "Forgot Password?"');
    }
    throw signInError;
  }

  const existingEmailAccount = await findLifeguardAccountByEmail(email);
  const existingUsername = normalizeUsername(existingEmailAccount?.username || '');
  if (existingUsername && existingUsername !== username) {
    await signOut(auth).catch(() => {});
    throw new Error(`That email is linked to username "${existingUsername}". Sign in with that username.`);
  }

  if (auth.currentUser?.emailVerified) {
    await signOut(auth).catch(() => {});
    throw new Error('That email already belongs to an existing account. Sign in instead.');
  }

  await saveSignupRecords(accountRef, accountData, employeeRecord);
  showSignupVerification(
    username,
    accountData,
    'Setup resumed. Check your email, verify it, then sign in.'
  );
}

async function requireVerifiedCurrentUserForAccount(account) {
  const expectedEmail = (account?.employeeEmail || getAuthEmail(account) || '').trim().toLowerCase();
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Sign in again, then finish email verification.');
  }

  await currentUser.reload();
  const refreshedUser = auth.currentUser;
  const currentEmail = (refreshedUser?.email || '').trim().toLowerCase();
  if (expectedEmail && currentEmail && currentEmail !== expectedEmail) {
    await signOut(auth).catch(() => {});
    clearLifeguardSession();
    throw new Error('This verified email does not match this PoolPro account. Sign in again.');
  }

  if (!refreshedUser?.emailVerified) {
    clearLifeguardSession();
    throw new Error('Verify your email before opening PoolPro.');
  }
}

async function finalizeLifeguardAccess({ username, account, target, method }) {
  await requireVerifiedCurrentUserForAccount(account);
  stopVerifyStatusPoller();
  clearPendingVerificationContext();

  try {
    await setDoc(doc(db, 'lifeguardAccounts', username), {
      lastVerifiedAt: new Date().toISOString(),
      lastVerificationMethod: method || '',
      phoneLinked: !!account.phoneLinked,
    }, { merge: true });
  } catch (err) {
    console.warn('Could not update verification metadata:', err);
  }

  markDeviceVerified(account.employeeEmail || account.authEmail || '');
  persistLifeguardSession(buildEmployeeFromAccount(account), username);
  resetVerificationState();
  closeModal();

  const accepted = await requireUserAgreement(buildLifeguardAgreementContext(account, username), {
    onDecline: async () => {
      clearLifeguardSession();
    },
  });
  if (!accepted) return;

  window.location.href = target || getDestinationPath();
}

async function requirePasswordLoginAfterVerification(message) {
  const targetPath = pendingVerification?.target || getDestinationPath();
  const targetKey = targetKeyFromDestinationPath(targetPath);

  stopVerifyStatusPoller();
  clearPendingVerificationContext();
  resetVerificationState();
  await signOut(auth).catch(() => {});
  clearLifeguardSession();

  if (modal && modal.style.display !== 'block') {
    openModal(targetKey);
  } else {
    pendingTarget = targetKey;
    setRole('lifeguard');
    setModalView('login');
  }

  setMessage(
    messageEl,
    message || 'Your email has been verified. Sign in with your username and password to continue.'
  );
}

function openVerificationView({
  username,
  account,
  target,
  force = false,
  origin = 'login',
  emailAuthMode = EMAIL_AUTH_MODE_VERIFY,
}) {
  const normalizedUsername = normalizeUsername(username);
  const targetPath = sanitizeTarget(target || getDestinationPath());
  const email = (account.employeeEmail || getAuthEmail(account) || '').trim().toLowerCase();
  const priorContext = loadPendingVerificationContext();
  const priorEmail = (priorContext?.email || '').trim().toLowerCase();
  const priorSentAt =
    priorContext?.username === normalizedUsername &&
    priorEmail &&
    priorEmail === email &&
    priorContext?.emailAuthMode === emailAuthMode
      ? Number(priorContext.sentAt || 0)
      : 0;

  pendingVerification = {
    username: normalizedUsername,
    account,
    target: targetPath,
    origin,
    force,
    emailAuthMode,
  };

  savePendingVerificationContext({
    username: pendingVerification.username,
    email,
    target: pendingVerification.target,
    sentAt: priorSentAt,
    emailAuthMode,
  });

  if (verifySubtitleEl) {
    verifySubtitleEl.textContent = `Verify the email sent to ${maskEmail(email)}. Then return and sign in with your username and password.`;
  }
  if (verifyHintEl) {
    verifyHintEl.textContent = 'Check spam if it does not arrive within 60 seconds. Use resend if needed.';
  }
  if (verifyResendBtn) verifyResendBtn.textContent = 'Resend Verification';
  setMessage(
    verifyMessageEl,
    ''
  );
  setModalView('verify');
  startVerificationStatusPolling();

  const existingContext = loadPendingVerificationContext();
  const existingEmail = (existingContext?.email || '').trim().toLowerCase();
  if (
    existingContext?.username === pendingVerification.username &&
    existingEmail &&
    existingEmail === email &&
    existingContext?.emailAuthMode === emailAuthMode &&
    Number(existingContext?.sentAt || 0) > 0 &&
    (Date.now() - Number(existingContext.sentAt)) < VERIFY_EMAIL_RESEND_MS
  ) {
    verifyCooldownUntil = Number(existingContext.sentAt) + VERIFY_EMAIL_RESEND_MS;
    updateVerifyCooldownUi();
    setMessage(
      verifyMessageEl,
      `A verification email was recently sent to ${maskEmail(email)}.`
    );
    return;
  }

  if (auth.currentUser?.emailVerified) {
    confirmVerifiedEmail().catch((err) => {
      setMessage(verifyMessageEl, err.message || 'Your email is verified, but PoolPro could not finish sign-in yet.', true);
    });
    return;
  }

  sendVerificationEmail({ isResend: false }).catch((err) => {
    console.error('Unable to send initial verification email:', err);
    const code = err.code || '';
    const friendly = code === 'auth/operation-not-allowed'
      ? 'Email/password sign-in is not enabled yet.'
      : code === 'auth/too-many-requests'
        ? 'Too many attempts. Wait a few minutes, then resend.'
      : code === 'auth/invalid-email'
        ? 'That email address is invalid.'
      : (err.message || 'Unable to send the verification email.');
    setMessage(verifyMessageEl, friendly, true);
  });
}

function markSupervisorLoggedIn(email) {
  try {
    localStorage.setItem('trainingSupervisorLoggedIn', 'true');
    localStorage.setItem('training_supervisor_logged_in_v1', 'true');
    localStorage.setItem('ChemLogSupervisor', 'true');
    const expires = Date.now() + VERIFY_WINDOW_MS;
    localStorage.setItem('loginToken', JSON.stringify({ username: email || 'supervisor', expires }));
    localStorage.setItem(ROLE_STORAGE_KEY, 'supervisor');
    localStorage.removeItem(LIFEGUARD_SESSION_KEY);
    markDeviceVerified(email);
  } catch (err) {
    console.warn('Could not persist supervisor login flags', err);
  }
}

async function authenticateSupervisor(email, password) {
  const e = (email || '').trim();
  const p = password || '';
  if (!e || !p) throw new Error('Please enter your email and password.');
  assertLoginAttemptsRemaining('supervisor', e);

  try {
    if (window.supervisorSignIn) {
      await window.supervisorSignIn(e, p);
    } else {
      await signInWithEmailAndPassword(auth, e, p);
      markSupervisorLoggedIn(e);
    }
    clearLoginFailures('supervisor', e);
  } catch (err) {
    const code = err.code || '';
    if (code === 'agreement/required') {
      clearLoginFailures('supervisor', e);
      throw err;
    }
    if (
      code === 'auth/wrong-password' ||
      code === 'auth/user-not-found' ||
      code === 'auth/invalid-credential' ||
      code === 'auth/too-many-requests'
    ) {
      const state = recordLoginFailure('supervisor', e, {
        lockImmediately: code === 'auth/too-many-requests',
      });
      if (state.blockedUntil && state.blockedUntil > Date.now()) {
        throw createLoginLockoutError(state.blockedUntil - Date.now());
      }
      throw new Error('Email or password not recognized.');
    }
    throw err;
  }
}

async function authenticateLifeguard(usernameRaw, passwordRaw) {
  const username = normalizeUsername(usernameRaw);
  const password = passwordRaw || '';
  if (!username || !password) throw new Error('Please enter your username and password.');
  assertLoginAttemptsRemaining('lifeguard', username);

  const account = await getLifeguardAccount(username);
  const authEmail = getAuthEmail(account);
  if (!authEmail) throw new Error('This account is missing an email address. Please contact your supervisor.');

  try {
    await signInWithEmailAndPassword(auth, authEmail, password);
  } catch (err) {
    const code = err.code || '';
    if (
      code === 'auth/wrong-password' ||
      code === 'auth/invalid-credential' ||
      code === 'auth/too-many-requests'
    ) {
      const state = recordLoginFailure('lifeguard', username, {
        lockImmediately: code === 'auth/too-many-requests',
      });
      if (state.blockedUntil && state.blockedUntil > Date.now()) {
        throw createLoginLockoutError(state.blockedUntil - Date.now());
      }
      throw new Error('Incorrect password. Try again or use "Forgot Password?"');
    }
    throw err;
  }
  clearLoginFailures('lifeguard', username);
  const user = auth.currentUser;

  if (!user?.emailVerified) {
    openVerificationView({
      username,
      account,
      target: getDestinationPath(),
      origin: 'login',
      emailAuthMode: EMAIL_AUTH_MODE_VERIFY,
    });
    return { requiresVerification: true };
  }

  await finalizeLifeguardAccess({
    username,
    account,
    target: getDestinationPath(),
    method: 'password-login',
  });
  return { requiresVerification: false };
}

async function sendVerificationEmail({ isResend = false } = {}) {
  if (!pendingVerification) throw new Error('No verification session is active.');
  const email = (pendingVerification.account.employeeEmail || getAuthEmail(pendingVerification.account) || '').trim().toLowerCase();
  if (!email) throw new Error('This account does not have an email address on file.');
  if (!auth.currentUser) throw new Error('Sign in again before requesting another verification email.');
  await auth.currentUser.reload();
  const currentEmail = (auth.currentUser?.email || '').trim().toLowerCase();
  if (currentEmail && currentEmail !== email) {
    await signOut(auth).catch(() => {});
    throw new Error('This signed-in email does not match the account. Sign in again.');
  }
  if (auth.currentUser.emailVerified) throw new Error('This email is already verified. Sign in to continue.');
  if (isResend && Date.now() < verifyCooldownUntil) {
    const remainingSeconds = Math.ceil((verifyCooldownUntil - Date.now()) / 1000);
    throw new Error(`Wait ${remainingSeconds} more second${remainingSeconds === 1 ? '' : 's'} before resending.`);
  }

  auth.useDeviceLanguage();
  await sendEmailVerification(auth.currentUser, {
    url: buildVerificationActionUrl({
      username: pendingVerification.username,
      target: pendingVerification.target,
      emailAuthMode: EMAIL_AUTH_MODE_VERIFY,
    }),
    handleCodeInApp: false,
  });

  savePendingVerificationContext({
    username: pendingVerification.username,
    email,
    target: pendingVerification.target,
    sentAt: Date.now(),
    emailAuthMode: EMAIL_AUTH_MODE_VERIFY,
  });

  startVerifyCooldown();
  setMessage(
    verifyMessageEl,
    `${isResend ? 'Verification email resent' : 'Verification email sent'} to ${maskEmail(email)}. Verify it, then sign in.`
  );
}

async function confirmVerifiedEmail() {
  if (!pendingVerification) throw new Error('No verification session is active.');
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Sign in again to finish verification.');

  await currentUser.reload();
  if (!currentUser.emailVerified) {
    throw new Error('Your email is not verified yet. Open the email, click the link, then try again.');
  }

  await requirePasswordLoginAfterVerification('Your email has been verified. Sign in with your username and password to continue.');
}

function startVerificationStatusPolling() {
  stopVerifyStatusPoller();
  verifyStatusPoller = window.setInterval(async () => {
    if (!pendingVerification || !auth.currentUser) return;
    try {
      await auth.currentUser.reload();
      if (auth.currentUser.emailVerified) {
        await confirmVerifiedEmail();
      }
    } catch (_) {
      // Keep polling quietly while the verify view is open.
    }
  }, 2500);
}

async function handleEmailVerificationRedirect() {
  const url = new URL(window.location.href);
  const mode = url.searchParams.get('mode');
  const oobCode = url.searchParams.get('oobCode');
  if (mode !== 'verifyEmail' || !oobCode) return false;

  try {
    await applyActionCode(auth, oobCode);
    if (auth.currentUser) {
      await auth.currentUser.reload();
    }

    const target = sanitizeTarget(url.searchParams.get('target') || loadPendingVerificationContext()?.target || DESTINATIONS.chem);

    window.history.replaceState({}, document.title, window.location.pathname);
    clearPendingVerificationContext();
    resetVerificationState();
    await signOut(auth).catch(() => {});
    openModal(targetKeyFromDestinationPath(target));
    setMessage(messageEl, 'Email verified. Sign in with your username and password.', false);
  } catch (err) {
    console.error('Email verification redirect failed:', err);
    window.history.replaceState({}, document.title, window.location.pathname);
    openModal('chem');
    setMessage(messageEl, err.message || 'That verification link is invalid or expired. Sign in again for a new one.', true);
  }

  return true;
}

async function handleSubmit(event) {
  event.preventDefault();
  setMessage(messageEl, '');

  try {
    if (currentRole === 'lifeguard') {
      const result = await authenticateLifeguard(usernameInput.value, passwordInput.value);
      if (result?.requiresVerification) return;
      return;
    }

    await authenticateSupervisor(usernameInput.value, passwordInput.value);
    closeModal();
    const accepted = await requireUserAgreement(buildSupervisorAgreementContext(usernameInput.value), {
      onDecline: async () => {
        await signOut(auth).catch(() => {});
        clearSupervisorSession();
      },
    });
    if (!accepted) return;
    window.location.href = getDestinationPath();
  } catch (err) {
    console.error('Home login failed:', err);
    const code = err.code || '';
    const friendly = code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential'
      ? (currentRole === 'lifeguard'
        ? 'Username not found. Create an account first, then ask your supervisor for help if the issue persists.'
        : 'Email or password not recognized.')
      : code === 'agreement/required'
        ? 'You must accept the user agreement before using PoolPro.'
      : (err.message || 'Login failed. Please try again.');
    setMessage(messageEl, friendly, true);
  }
}

async function handleCreateAccountSubmit(event) {
  event.preventDefault();
  if (createAccountSubmitting) return;
  setCreateAccountSubmitting(true);
  setMessage(createMessageEl, '');

  try {
    const username = normalizeUsername(createUsernameInput?.value);
    const firstName = createFirstNameInput?.value.trim() || '';
    const lastName = createLastNameInput?.value.trim() || '';
    const email = (createEmailInput?.value.trim() || '').toLowerCase();
    const phone = normalizePhoneDigits(createPhoneInput?.value);
    const homePool = createPoolInput?.value || '';
    const password = createPasswordInput?.value || '';
    const confirmPassword = createConfirmPasswordInput?.value || '';

    if (!username) return setMessage(createMessageEl, 'Please choose a username.', true);
    if (username.length < 4) return setMessage(createMessageEl, 'Usernames must be at least 4 characters long.', true);
    if (!firstName || !lastName || !email || !homePool || !password || !confirmPassword) {
      return setMessage(createMessageEl, 'Please complete every field in the account form.', true);
    }
    if (!email.includes('@')) return setMessage(createMessageEl, 'Please enter a valid email address.', true);
    if (!phone) return setMessage(createMessageEl, 'Please enter a phone number.', true);
    if (password !== confirmPassword) return setMessage(createMessageEl, 'Passwords do not match.', true);

    const passwordValidationMessage = validatePassword(password);
    if (passwordValidationMessage) return setMessage(createMessageEl, passwordValidationMessage, true);

    const accountRef = doc(db, 'lifeguardAccounts', username);
    const existingAccount = await getDoc(accountRef);
    if (existingAccount.exists()) return setMessage(createMessageEl, 'That username is already taken. Please choose another one.', true);

    const { employeeRecord, accountData } = buildSignupRecords({
      username,
      firstName,
      lastName,
      email,
      phone,
      homePool,
    });

    await createUserWithEmailAndPassword(auth, email, password);
    await auth.currentUser?.reload();
    if (auth.currentUser?.emailVerified) {
      await signOut(auth).catch(() => {});
      throw new Error('This email already belongs to an existing account. Sign in instead.');
    }
    await saveSignupRecords(accountRef, accountData, employeeRecord);

    showSignupVerification(
      username,
      accountData,
      'Check your email, verify it, then return and sign in.'
    );
  } catch (err) {
    console.error('Create account failed:', err);
    const code = err.code || '';

    if (code === 'auth/email-already-in-use') {
      try {
        const username = normalizeUsername(createUsernameInput?.value);
        const firstName = createFirstNameInput?.value.trim() || '';
        const lastName = createLastNameInput?.value.trim() || '';
        const email = (createEmailInput?.value.trim() || '').toLowerCase();
        const phone = normalizePhoneDigits(createPhoneInput?.value);
        const homePool = createPoolInput?.value || '';
        const password = createPasswordInput?.value || '';
        const accountRef = doc(db, 'lifeguardAccounts', username);
        const { employeeRecord, accountData } = buildSignupRecords({
          username,
          firstName,
          lastName,
          email,
          phone,
          homePool,
        });
        await resumeInterruptedSignup({ username, email, password, accountRef, accountData, employeeRecord });
        return;
      } catch (resumeError) {
        await signOut(auth).catch(() => {});
        console.error('Interrupted signup recovery failed:', resumeError);
        setMessage(createMessageEl, resumeError.message || 'That email already has an account. Use "Forgot Password?" if needed.', true);
        return;
      }
    }

    await signOut(auth).catch(() => {});
    const friendly = code === 'auth/operation-not-allowed'
      ? 'Email/password sign-in is not enabled yet.'
      : code === 'permission-denied'
        ? 'The account could not be saved right now. Try again in a moment.'
        : code === 'auth/invalid-email'
          ? 'Please enter a valid email address.'
        : (err.message || 'Unable to create your account right now.');
    setMessage(createMessageEl, friendly, true);
  } finally {
    setCreateAccountSubmitting(false);
  }
}

async function handleResetPasswordSubmit(event) {
  event.preventDefault();
  setMessage(resetMessageEl, '');
  const value = (resetFieldInput?.value || '').trim();
  if (!value) {
    setMessage(resetMessageEl, currentRole === 'lifeguard' ? 'Please enter your username.' : 'Please enter your email.', true);
    return;
  }

  try {
    let resetEmail = value;
    if (currentRole === 'lifeguard') {
      const account = await getLifeguardAccount(normalizeUsername(value));
      resetEmail = account.authEmail || account.employeeEmail || '';
      if (!resetEmail) throw new Error('No email address found for this username. Contact your supervisor.');
    }
    await sendPasswordResetEmail(auth, resetEmail);
    setMessage(resetMessageEl, 'Password reset email sent. Check your inbox.', false);
    if (resetFieldInput) resetFieldInput.value = '';
  } catch (err) {
    const code = err.code || '';
    const friendly = code === 'auth/user-not-found' || code === 'auth/invalid-email'
      ? (currentRole === 'lifeguard' ? 'Username not found.' : 'No account found for that email.')
      : (err.message || 'Could not send reset email. Please try again.');
    setMessage(resetMessageEl, friendly, true);
  }
}

function wireMenu() {
  document.querySelectorAll('.home-menu-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      pendingTarget = target;
      if (target === 'supervisor') {
        if (hasFreshSupervisorSession()) {
          window.location.href = getDestinationPath();
          return;
        }
        openModal(target);
        return;
      }

      if (getStoredLifeguardSession() || hasFreshSupervisorSession()) {
        window.location.href = getDestinationPath();
        return;
      }

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
  mountUnifiedFooter();
  const handledVerificationRedirect = await handleEmailVerificationRedirect();
  await Promise.all([loadEmployees(), loadPools()]);
  populatePoolOptions();
  wireMenu();
  wireRoleToggle();
  setupMobileModalFocusGuards();

  form?.addEventListener('submit', handleSubmit);
  createAccountForm?.addEventListener('submit', handleCreateAccountSubmit);
  closeBtn?.addEventListener('click', async () => {
    if (auth.currentUser && currentRole === 'lifeguard') {
      await signOut(auth).catch(() => {});
    }
    closeModal();
  });
  showCreateAccountBtn?.addEventListener('click', () => setModalView('create'));
  forgotPasswordBtn?.addEventListener('click', () => setModalView('reset'));
  resetPasswordForm?.addEventListener('submit', handleResetPasswordSubmit);
  resetBackBtn?.addEventListener('click', () => {
    setMessage(resetMessageEl, '');
    if (resetFieldInput) resetFieldInput.value = '';
    setModalView('login');
  });
  backToLoginBtn?.addEventListener('click', async () => {
    await signOut(auth).catch(() => {});
    resetVerificationState();
    clearPendingVerificationContext();
    setModalView('login');
  });
  verifyBackBtn?.addEventListener('click', async () => {
    await signOut(auth).catch(() => {});
    resetVerificationState();
    clearPendingVerificationContext();
    setModalView('login');
  });
  verifyResendBtn?.addEventListener('click', async () => {
    try {
      await sendVerificationEmail({ isResend: true });
    } catch (err) {
      const code = err.code || '';
      const friendly = code === 'auth/operation-not-allowed'
        ? 'Email/password sign-in is not enabled yet.'
        : code === 'auth/too-many-requests'
          ? 'Too many attempts. Wait a few minutes, then resend.'
        : (err.message || 'Unable to resend the verification email.');
      setMessage(verifyMessageEl, friendly, true);
    }
  });
  modal?.addEventListener('click', async (event) => {
    if (event.target !== modal) return;
    if (auth.currentUser && currentRole === 'lifeguard') {
      await signOut(auth).catch(() => {});
    }
    closeModal();
  });

  const pendingContext = loadPendingVerificationContext();
  if (pendingContext?.username && auth.currentUser) {
    const pendingMode = pendingContext.emailAuthMode || EMAIL_AUTH_MODE_VERIFY;
    const account = await getLifeguardAccount(pendingContext.username);
    if (auth.currentUser.emailVerified) {
      pendingVerification = {
        username: pendingContext.username,
        account,
        target: pendingContext.target || getDestinationPath(),
        origin: handledVerificationRedirect ? 'redirect-resume' : 'resume',
        force: true,
        emailAuthMode: pendingMode,
      };
      await requirePasswordLoginAfterVerification('Your email has been verified. Sign in with your username and password to continue.');
      return;
    }
    openVerificationView({
      username: pendingContext.username,
      account,
      target: pendingContext.target || getDestinationPath(),
      force: true,
      origin: handledVerificationRedirect ? 'redirect-resume' : 'resume',
      emailAuthMode: pendingMode,
    });
  }

  if (handledVerificationRedirect) return;

  let initialRole = 'lifeguard';
  try {
    const stored = localStorage.getItem(ROLE_STORAGE_KEY);
    if (stored === 'supervisor' || stored === 'lifeguard') initialRole = stored;
  } catch (err) {
    console.warn('Could not read stored role; defaulting to lifeguard', err);
  }

  setRole(initialRole);
  setModalView('login');
});

window.addEventListener('focus', async () => {
  if (!pendingVerification || !auth.currentUser) return;
  try {
    await auth.currentUser.reload();
    if (auth.currentUser.emailVerified) {
      await confirmVerifiedEmail();
    }
  } catch (_) {
    // Ignore transient reload issues while waiting on verification.
  }
});

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  if (!pendingVerification || !auth.currentUser) return;
  try {
    await auth.currentUser.reload();
    if (auth.currentUser.emailVerified) {
      await confirmVerifiedEmail();
    }
  } catch (_) {
    // Ignore transient reload issues while waiting on verification.
  }
});

window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});
