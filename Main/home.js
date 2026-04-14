// home.js – landing page login logic
import { db, auth, doc, getDoc, setDoc, getDocs, collection, onAuthStateChanged } from '../firebase.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  EmailAuthProvider,
  reauthenticateWithCredential,
  RecaptchaVerifier,
  linkWithPhoneNumber,
  reauthenticateWithPhoneNumber
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
const ALLOWED_PASSWORD_CHARS = /^[A-Za-z0-9!@#$%^&*()_\-+=[\]{};:'",.<>/?\\|`~]+$/;

let pendingTarget = null;
let currentRole = 'lifeguard';
let currentView = 'login';
let employeesCache = [];
let employeeDocSnapshot = [];
let homePoolOptions = [];
let pendingVerification = null;
let phoneRecaptchaVerifier = null;

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
const verifyCodeGroup = document.getElementById('homeVerifyCodeGroup');
const verifyCodeInput = document.getElementById('homeVerifyCodeInput');
const verifyEmailBtn = document.getElementById('homeVerifyEmailBtn');
const verifySmsBtn = document.getElementById('homeVerifySmsBtn');
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

function hasPendingEmailVerification() {
  return !!loadPendingVerificationContext();
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
  pendingVerification = null;
  if (verifyForm) verifyForm.reset();
  verifyCodeGroup?.classList.add('hidden');
  if (verifySubtitleEl) verifySubtitleEl.textContent = '';
  if (phoneRecaptchaVerifier) {
    try { phoneRecaptchaVerifier.clear(); } catch (_) { /* ignore */ }
    phoneRecaptchaVerifier = null;
  }
  const recaptchaContainer = document.getElementById('homeRecaptchaContainer');
  if (recaptchaContainer) recaptchaContainer.innerHTML = '';
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
  if (view === 'verify') verifyEmailBtn?.focus();
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
  localStorage.setItem(ROLE_STORAGE_KEY, 'lifeguard');
  localStorage.removeItem('loginToken');
  localStorage.removeItem('ChemLogSupervisor');
  localStorage.removeItem('trainingSupervisorLoggedIn');
  localStorage.removeItem('training_supervisor_logged_in_v1');
  localStorage.removeItem('chemlogTrainingSupervisorLoggedIn');
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
  if (!accountSnap.exists()) throw new Error('Username not found. Create an account or contact your supervisor.');
  return { username, ...accountSnap.data() };
}

async function waitForAuthUser() {
  if (auth.currentUser) return auth.currentUser;
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
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
  clearPendingVerificationContext();

  try {
    await setDoc(doc(db, 'lifeguardAccounts', username), {
      lastVerifiedAt: new Date().toISOString(),
      lastVerificationMethod: method || '',
      phoneLinked: method === 'sms' ? true : !!account.phoneLinked,
    }, { merge: true });
  } catch (err) {
    console.warn('Could not update verification metadata:', err);
  }

  persistLifeguardSession(buildEmployeeFromAccount(account), username);
  await signOut(auth).catch(() => {});
  resetVerificationState();
  closeModal();
  window.location.href = target || getDestinationPath();
}

function openVerificationView({ username, account, target, force = false, origin = 'login' }) {
  pendingVerification = {
    username: normalizeUsername(username),
    account,
    target: target || getDestinationPath(),
    origin,
    confirmationResult: null,
    force,
  };

  const phoneNumber = normalizePhoneE164(account.phone);
  if (verifySubtitleEl) {
    verifySubtitleEl.textContent = `Choose how to verify this ${force ? 'new' : ''} device for ${account.firstName || 'your'} account. Email will go to ${maskEmail(account.employeeEmail)}.${phoneNumber ? ` Text messages will go to ${maskPhone(phoneNumber)}.` : ''}`;
  }
  verifySmsBtn?.toggleAttribute('disabled', !phoneNumber);
  verifyCodeGroup?.classList.add('hidden');
  verifyCodeInput && (verifyCodeInput.value = '');
  setMessage(verifyMessageEl, 'Verification is required on new devices and every 10 days.');
  setModalView('verify');
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

  if (shouldRequireStepUp(username)) {
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

async function ensurePhoneVerifier() {
  const user = auth.currentUser || await waitForAuthUser();
  if (!user) throw new Error('Please sign in again before requesting a text message.');

  if (phoneRecaptchaVerifier) {
    try { phoneRecaptchaVerifier.clear(); } catch (_) { /* ignore */ }
    phoneRecaptchaVerifier = null;
  }

  const container = document.getElementById('homeRecaptchaContainer');
  if (!container) throw new Error('Phone verification is not available right now.');
  container.innerHTML = '';

  phoneRecaptchaVerifier = new RecaptchaVerifier(auth, container, {
    size: 'invisible',
  });
  await phoneRecaptchaVerifier.render();
  return phoneRecaptchaVerifier;
}

async function sendEmailVerificationLink() {
  if (!pendingVerification) throw new Error('No verification session is active.');
  const email = pendingVerification.account.employeeEmail || getAuthEmail(pendingVerification.account);
  if (!email) throw new Error('This account does not have an email address on file.');

  savePendingVerificationContext({
    username: pendingVerification.username,
    email,
    target: pendingVerification.target,
  });

  await sendSignInLinkToEmail(auth, email, {
    url: `${window.location.origin}${window.location.pathname}`,
    handleCodeInApp: true,
  });

  setMessage(verifyMessageEl, `Verification link sent to ${maskEmail(email)}. Open it on this device to finish signing in.`);
}

async function sendSmsVerificationCode() {
  if (!pendingVerification) throw new Error('No verification session is active.');
  const phoneNumber = normalizePhoneE164(pendingVerification.account.phone);
  if (!phoneNumber) throw new Error('Add a valid phone number before using text-message verification.');

  const user = auth.currentUser || await waitForAuthUser();
  if (!user) throw new Error('Please sign in again before requesting a text message.');

  const verifier = await ensurePhoneVerifier();
  const hasPhoneProvider = user.providerData.some((provider) => provider.providerId === 'phone');
  pendingVerification.confirmationResult = hasPhoneProvider
    ? await reauthenticateWithPhoneNumber(user, phoneNumber, verifier)
    : await linkWithPhoneNumber(user, phoneNumber, verifier);

  verifyCodeGroup?.classList.remove('hidden');
  verifyCodeInput?.focus();
  setMessage(verifyMessageEl, `Verification code sent to ${maskPhone(phoneNumber)}.`);
}

async function submitSmsVerificationCode(event) {
  event.preventDefault();
  if (!pendingVerification?.confirmationResult) {
    setMessage(verifyMessageEl, 'Request a text message first.', true);
    return;
  }

  const code = (verifyCodeInput?.value || '').trim();
  if (!code) {
    setMessage(verifyMessageEl, 'Enter the text message code to continue.', true);
    return;
  }

  await pendingVerification.confirmationResult.confirm(code);
  const account = {
    ...pendingVerification.account,
    phoneLinked: true,
  };
  await finalizeLifeguardAccess({
    username: pendingVerification.username,
    account,
    target: pendingVerification.target,
    method: 'sms',
  });
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
    window.location.href = getDestinationPath();
  } catch (err) {
    console.error('Home login failed:', err);
    const code = err.code || '';
    const friendly = code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential'
      ? (currentRole === 'lifeguard' ? 'Incorrect username or password.' : 'Incorrect email or password.')
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
  if (!phone) return setMessage(createMessageEl, 'Please enter a phone number so text verification is available.', true);
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
    setMessage(verifyMessageEl, 'Choose email or text-message verification to finish creating your account.');
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

async function handleEmailLinkCallback() {
  if (!isSignInWithEmailLink(auth, window.location.href)) return false;

  const context = loadPendingVerificationContext();
  if (!context?.username || !context?.email) {
    console.error('Missing pending verification context for email-link authentication.');
    return false;
  }

  const user = auth.currentUser || await waitForAuthUser();
  if (!user) {
    setMessage(messageEl, 'Please open the email link on the same device you used to sign in.', true);
    return false;
  }

  try {
    const credential = EmailAuthProvider.credentialWithLink(context.email, window.location.href);
    await reauthenticateWithCredential(user, credential);
    const account = await getLifeguardAccount(context.username);
    window.history.replaceState({}, document.title, window.location.pathname);
    await finalizeLifeguardAccess({
      username: context.username,
      account,
      target: context.target,
      method: 'email',
    });
    return true;
  } catch (err) {
    console.error('Email link verification failed:', err);
    setMessage(messageEl, err.message || 'Email verification failed. Please try again.', true);
    return false;
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
  const handledLink = await handleEmailLinkCallback();
  if (handledLink) return;

  await Promise.all([loadEmployees(), loadPools()]);
  populatePoolOptions();
  wireMenu();
  wireRoleToggle();

  form?.addEventListener('submit', handleSubmit);
  createAccountForm?.addEventListener('submit', handleCreateAccountSubmit);
  verifyForm?.addEventListener('submit', submitSmsVerificationCode);
  closeBtn?.addEventListener('click', async () => {
    if (auth.currentUser && currentRole === 'lifeguard' && !hasPendingEmailVerification()) {
      await signOut(auth).catch(() => {});
    }
    closeModal();
  });
  showCreateAccountBtn?.addEventListener('click', () => setModalView('create'));
  backToLoginBtn?.addEventListener('click', async () => {
    if (!hasPendingEmailVerification()) {
      await signOut(auth).catch(() => {});
    }
    resetVerificationState();
    setModalView('login');
  });
  verifyBackBtn?.addEventListener('click', async () => {
    if (!hasPendingEmailVerification()) {
      await signOut(auth).catch(() => {});
    }
    resetVerificationState();
    setModalView('login');
  });
  verifyEmailBtn?.addEventListener('click', async () => {
    try {
      await sendEmailVerificationLink();
    } catch (err) {
      const code = err.code || '';
      const friendly = code === 'auth/operation-not-allowed'
        ? 'Enable Email Link sign-in in Firebase Authentication to use email verification.'
        : (err.message || 'Unable to send the verification email.');
      setMessage(verifyMessageEl, friendly, true);
    }
  });
  verifySmsBtn?.addEventListener('click', async () => {
    try {
      await sendSmsVerificationCode();
    } catch (err) {
      const code = err.code || '';
      const friendly = code === 'auth/operation-not-allowed'
        ? 'Enable Phone sign-in in Firebase Authentication to use text-message verification.'
        : (err.message || 'Unable to send the text message.');
      setMessage(verifyMessageEl, friendly, true);
    }
  });
  modal?.addEventListener('click', async (event) => {
    if (event.target !== modal) return;
    if (auth.currentUser && currentRole === 'lifeguard' && !hasPendingEmailVerification()) {
      await signOut(auth).catch(() => {});
    }
    closeModal();
  });

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
