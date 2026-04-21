// home.js – landing page login logic
import { db, auth, doc, getDoc, setDoc, getDocs, collection } from '../firebase.js';
import { requireUserAgreement } from '../agreement.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendEmailVerification,
  applyActionCode
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';

const DESTINATIONS = {
  chem: 'chem/chem.html',
  training: 'Training/training.html',
  supervisor: 'chem/chem.html#supervisorDashboard'
};

const ROLE_STORAGE_KEY = 'chemlogRole';
const DEVICE_ID_KEY = 'poolproDeviceId';
const VERIFY_CONTEXT_KEY = 'poolproPendingLifeguardVerification';
const VERIFY_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;
const VERIFY_EMAIL_RESEND_MS = 30 * 1000;
const ALLOWED_PASSWORD_CHARS = /^[A-Za-z0-9!@#$%^&*()_\-+=[\]{};:'",.<>/?\\|`~]+$/;

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
const verifyResendBtn = document.getElementById('homeVerifyResendBtn');
const verifyCooldownText = document.getElementById('homeVerifyCooldownText');
const verifyBackBtn = document.getElementById('homeVerifyBackBtn');
const roleToggle = document.getElementById('roleToggle');
const showCreateAccountBtn = document.getElementById('homeShowCreateAccountBtn');
const backToLoginBtn = document.getElementById('homeBackToLoginBtn');
const createUsernameInput = document.getElementById('homeCreateUsernameInput');
const createFirstNameInput = document.getElementById('homeCreateFirstNameInput');
const createLastNameInput = document.getElementById('homeCreateLastNameInput');
const createEmailInput = document.getElementById('homeCreateEmailInput');
const createPhoneInput = document.getElementById('homeCreatePhoneInput');
const createPoolInput = document.getElementById('homeCreatePoolInput');
const createPasswordInput = document.getElementById('homeCreatePasswordInput');
const createConfirmPasswordInput = document.getElementById('homeCreateConfirmPasswordInput');

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

function getOrCreateDeviceId() {
  try {
    let deviceId = localStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId = `device_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
      localStorage.setItem(DEVICE_ID_KEY, deviceId);
    }
    return deviceId;
  } catch (_) {
    return 'device_fallback';
  }
}

function getVerificationStorageKey(username) {
  return `poolproAuthVerified:${normalizeUsername(username)}:${getOrCreateDeviceId()}`;
}

function shouldRequireStepUp(username, force = false) {
  if (force) return true;
  try {
    const lastVerified = Number(localStorage.getItem(getVerificationStorageKey(username)) || '0');
    if (!lastVerified) return true;
    return (Date.now() - lastVerified) >= VERIFY_WINDOW_MS;
  } catch (_) {
    return true;
  }
}

function markVerificationComplete(username) {
  try {
    localStorage.setItem(getVerificationStorageKey(username), Date.now().toString());
  } catch (_) { /* ignore */ }
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

function sanitizeTarget(target) {
  const candidate = String(target || '').trim();
  if (!candidate) return DESTINATIONS.chem;
  return Object.values(DESTINATIONS).includes(candidate) ? candidate : DESTINATIONS.chem;
}

function buildVerificationActionUrl({ username, target }) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('username', normalizeUsername(username));
  url.searchParams.set('target', sanitizeTarget(target));
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
      ? `You can resend the verification email in ${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'}.`
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

  if (modalTitle) {
    modalTitle.textContent = view === 'create'
      ? 'Create Account'
      : view === 'verify'
        ? 'Verify Identity'
        : 'Sign in';
  }

  if (view === 'create') createUsernameInput?.focus();
  if (view === 'verify') verifyResendBtn?.focus();
  if (view === 'login') usernameInput?.focus();
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
  sessionStorage.setItem('chemlogRole', 'lifeguard');
  sessionStorage.setItem('chemlogEmployeeEmail', normalizedEmployee.email || '');
  sessionStorage.setItem('chemlogEmployeeId', normalizedEmployee.email || normalizedEmployee.id || '');
  sessionStorage.setItem('chemlogEmployeeUsername', normalizeUsername(username || normalizedEmployee.username || ''));
  sessionStorage.setItem('chemlogEmployeeFirstName', normalizedEmployee.firstName || '');
  sessionStorage.setItem('chemlogEmployeeLastName', normalizedEmployee.lastName || '');
  localStorage.setItem(ROLE_STORAGE_KEY, 'lifeguard');
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

  clearMessages();
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

    throw new Error('Username not found. Create an account first, or ask your supervisor to confirm your Employees entry has the correct username.');
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

async function finalizeLifeguardAccess({ username, account, target, method }) {
  markVerificationComplete(username);
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

  persistLifeguardSession(buildEmployeeFromAccount(account), username);
  await signOut(auth).catch(() => {});
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

function openVerificationView({ username, account, target, force = false, origin = 'login' }) {
  pendingVerification = {
    username: normalizeUsername(username),
    account,
    target: sanitizeTarget(target || getDestinationPath()),
    origin,
    force,
  };

  savePendingVerificationContext({
    username: pendingVerification.username,
    email: (account.employeeEmail || getAuthEmail(account) || '').trim().toLowerCase(),
    target: pendingVerification.target,
    sentAt: Number(loadPendingVerificationContext()?.sentAt || 0),
  });

  if (verifySubtitleEl) {
    verifySubtitleEl.textContent = `Email verification is required before PoolPro access${force ? ' for this new account' : ''}. Check ${maskEmail(account.employeeEmail || getAuthEmail(account))}, open the verification email, and PoolPro will finish access automatically after the link is clicked.`;
  }
  setMessage(verifyMessageEl, 'Verification is required on new devices and every 10 days. We are checking your email verification status automatically.');
  setModalView('verify');
  startVerificationStatusPolling();

  const existingContext = loadPendingVerificationContext();
  const existingEmail = (existingContext?.email || '').trim().toLowerCase();
  const nextEmail = (account.employeeEmail || getAuthEmail(account) || '').trim().toLowerCase();
  if (
    existingContext?.username === pendingVerification.username &&
    existingEmail &&
    existingEmail === nextEmail &&
    Number(existingContext?.sentAt || 0) > 0 &&
    (Date.now() - Number(existingContext.sentAt)) < VERIFY_EMAIL_RESEND_MS
  ) {
    verifyCooldownUntil = Number(existingContext.sentAt) + VERIFY_EMAIL_RESEND_MS;
    updateVerifyCooldownUi();
    setMessage(
      verifyMessageEl,
      `A verification email was recently sent to ${maskEmail(nextEmail)}. Click the email link and PoolPro will finish access automatically, or wait for the resend timer if you need another one.`
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
      ? 'Enable Email/Password sign-in and Email Verification in Firebase Authentication, then try again.'
      : code === 'auth/invalid-email'
        ? 'This account email is invalid in Firebase. Update the employee email and try again.'
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
    await signInWithEmailAndPassword(auth, e, p);
    markSupervisorLoggedIn(e);
  }
}

async function authenticateLifeguard(usernameRaw, passwordRaw) {
  const username = normalizeUsername(usernameRaw);
  const password = passwordRaw || '';
  if (!username || !password) throw new Error('Please enter your username and password.');

  const account = await getLifeguardAccount(username);
  const authEmail = getAuthEmail(account);
  if (!authEmail) throw new Error('This account is missing an email address. Please contact your supervisor.');

  await signInWithEmailAndPassword(auth, authEmail, password);
  const user = auth.currentUser;

  if (!user?.emailVerified || shouldRequireStepUp(username)) {
    openVerificationView({ username, account, target: getDestinationPath(), origin: 'login' });
    return { requiresVerification: true };
  }

  await finalizeLifeguardAccess({
    username,
    account,
    target: getDestinationPath(),
    method: 'recent',
  });
  return { requiresVerification: false };
}

async function sendVerificationEmail({ isResend = false } = {}) {
  if (!pendingVerification) throw new Error('No verification session is active.');
  const email = pendingVerification.account.employeeEmail || getAuthEmail(pendingVerification.account);
  if (!email) throw new Error('This account does not have an email address on file.');
  if (!auth.currentUser) throw new Error('Please sign in again before requesting a verification email.');
  if (auth.currentUser.emailVerified) throw new Error('This email is already verified. PoolPro should finish sign-in automatically.');
  if (isResend && Date.now() < verifyCooldownUntil) {
    const remainingSeconds = Math.ceil((verifyCooldownUntil - Date.now()) / 1000);
    throw new Error(`Please wait ${remainingSeconds} more second${remainingSeconds === 1 ? '' : 's'} before resending the verification email.`);
  }

  savePendingVerificationContext({
    username: pendingVerification.username,
    email,
    target: pendingVerification.target,
    sentAt: Date.now(),
  });

  auth.useDeviceLanguage();
  await sendEmailVerification(auth.currentUser, {
    url: buildVerificationActionUrl({
      username: pendingVerification.username,
      target: pendingVerification.target,
    }),
    handleCodeInApp: false,
  });
  startVerifyCooldown();
  setMessage(
    verifyMessageEl,
    `${isResend ? 'Verification email resent' : 'Verification email sent'} to ${maskEmail(email)}. Click the verification link in the email and PoolPro will finish sign-in automatically. If it does not appear soon, check spam or junk.`
  );
}

async function confirmVerifiedEmail() {
  if (!pendingVerification) throw new Error('No verification session is active.');
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Please sign in again to confirm verification.');

  await currentUser.reload();
  if (!currentUser.emailVerified) {
    throw new Error('Your email is not verified yet. Open the verification email, click the link, then try again.');
  }

  const account = await getLifeguardAccount(pendingVerification.username);
  await finalizeLifeguardAccess({
    username: pendingVerification.username,
    account,
    target: pendingVerification.target,
    method: 'email-verification',
  });
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

    const username = normalizeUsername(url.searchParams.get('username') || loadPendingVerificationContext()?.username || '');
    const target = sanitizeTarget(url.searchParams.get('target') || loadPendingVerificationContext()?.target || DESTINATIONS.chem);

    if (!username) {
      setMessage(messageEl, 'Your email was verified. Sign in again to continue.', false);
      window.history.replaceState({}, document.title, window.location.pathname);
      return true;
    }

    const account = await getLifeguardAccount(username);
    pendingVerification = {
      username,
      account,
      target,
      origin: 'redirect',
      force: false,
    };

    window.history.replaceState({}, document.title, window.location.pathname);

    if (auth.currentUser?.emailVerified) {
      await finalizeLifeguardAccess({
        username,
        account,
        target,
        method: 'email-verification-link',
      });
    } else {
      openModal(target === DESTINATIONS.training ? 'training' : 'chem');
      openVerificationView({ username, account, target, origin: 'redirect' });
      setMessage(verifyMessageEl, 'Your email was verified. PoolPro is restoring your sign-in session now.', false);
    }
  } catch (err) {
    console.error('Email verification redirect failed:', err);
    window.history.replaceState({}, document.title, window.location.pathname);
    setMessage(messageEl, err.message || 'That verification link is invalid or expired. Sign in again to get a new email.', true);
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
      ? (currentRole === 'lifeguard' ? 'Incorrect username or password.' : 'Incorrect email or password.')
      : code === 'agreement/required'
        ? 'You must accept the user agreement before using PoolPro.'
      : (err.message || 'Login failed. Please try again.');
    setMessage(messageEl, friendly, true);
  }
}

async function handleCreateAccountSubmit(event) {
  event.preventDefault();
  setMessage(createMessageEl, '');

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

  const duplicateEmail = employeesCache.find((employee) => {
    const normalizedEmployee = normalizeEmployeeRecord(employee);
    return normalizedEmployee.email === email && normalizedEmployee.username && normalizedEmployee.username !== username;
  });
  if (duplicateEmail) {
    return setMessage(createMessageEl, 'That email is already linked to another username. Please contact your supervisor.', true);
  }

  try {
    await createUserWithEmailAndPassword(auth, email, password);

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

    await Promise.all([
      setDoc(accountRef, accountData),
      upsertEmployeeRecord(employeeRecord),
    ]);

    openVerificationView({
      username,
      account: accountData,
      target: getDestinationPath(),
      force: true,
      origin: 'create',
    });
    setMessage(verifyMessageEl, 'Check your email and click the verification link. PoolPro will finish creating your access automatically after the link is opened.');
  } catch (err) {
    await signOut(auth).catch(() => {});
    console.error('Create account failed:', err);
    const code = err.code || '';
    const friendly = code === 'auth/email-already-in-use'
      ? 'That email address is already attached to a Firebase account.'
      : code === 'auth/operation-not-allowed'
        ? 'Enable Email/Password sign-in in Firebase Authentication, then try again.'
        : code === 'permission-denied'
          ? 'Firebase permissions blocked the account save. Publish the updated Firestore rules, then try again.'
          : (err.message || 'Unable to create your account right now.');
    setMessage(createMessageEl, friendly, true);
  }
}

function wireMenu() {
  document.querySelectorAll('.home-menu-item').forEach((btn) => {
    btn.addEventListener('click', () => openModal(btn.dataset.target));
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

  form?.addEventListener('submit', handleSubmit);
  createAccountForm?.addEventListener('submit', handleCreateAccountSubmit);
  closeBtn?.addEventListener('click', async () => {
    if (auth.currentUser && currentRole === 'lifeguard') {
      await signOut(auth).catch(() => {});
    }
    closeModal();
  });
  showCreateAccountBtn?.addEventListener('click', () => setModalView('create'));
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
        ? 'Enable Email/Password sign-in and Email Verification in Firebase Authentication, then try again.'
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

  if (handledVerificationRedirect) return;

  const pendingContext = loadPendingVerificationContext();
  if (pendingContext?.username && auth.currentUser) {
    const account = await getLifeguardAccount(pendingContext.username);
    openVerificationView({
      username: pendingContext.username,
      account,
      target: pendingContext.target || getDestinationPath(),
      force: true,
      origin: 'resume',
    });
  }

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

window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});
