// home.js – landing page login logic
import { db, auth, doc, getDoc, setDoc, getDocs, collection } from '../firebase.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';

const DESTINATIONS = {
  chem: 'chem/chem.html',
  training: 'Training/training.html',
  supervisor: 'chem/chem.html#supervisorDashboard'
};

const ROLE_STORAGE_KEY = 'chemlogRole';

let pendingTarget = null;
let currentRole = 'lifeguard';
let currentView = 'login';
let employeesCache = [];
let employeeDocSnapshot = [];
let homePoolOptions = [];

const modal = document.getElementById('homeLoginModal');
const closeBtn = document.getElementById('homeLoginClose');
const modalTitle = document.getElementById('homeModalTitle');
const form = document.getElementById('homeLoginForm');
const createAccountForm = document.getElementById('homeCreateAccountForm');
const usernameInput = document.getElementById('homeUsernameInput');
const passwordInput = document.getElementById('homePasswordInput');
const usernameLabel = document.getElementById('homeUsernameLabel');
const passwordLabel = document.getElementById('homePasswordLabel');
const messageEl = document.getElementById('homeLoginMessage');
const createMessageEl = document.getElementById('homeCreateAccountMessage');
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
const ALLOWED_PASSWORD_CHARS = /^[A-Za-z0-9!@#$%^&*()_\-+=[\]{};:'",.<>/?\\|`~]+$/;

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

function buildLifeguardAuthEmail(username) {
  return `${username}@lifeguard.poolpro.local`;
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

function setMessage(el, text, isError = false) {
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('error', !!text && isError);
}

function clearMessages() {
  setMessage(messageEl, '');
  setMessage(createMessageEl, '');
}

function resetForms() {
  form?.reset();
  createAccountForm?.reset();
  clearMessages();
}

function setModalView(view) {
  currentView = view;
  form?.classList.toggle('hidden', view !== 'login');
  createAccountForm?.classList.toggle('hidden', view !== 'create');
  if (modalTitle) {
    modalTitle.textContent = view === 'create' ? 'Create Account' : 'Sign in';
  }
  if (view === 'create') {
    createUsernameInput?.focus();
  } else {
    usernameInput?.focus();
  }
}

function getDestinationPath() {
  return pendingTarget ? DESTINATIONS[pendingTarget] : DESTINATIONS.chem;
}

function populatePoolOptions() {
  if (!createPoolInput) return;
  const currentValue = createPoolInput.value;
  const values = new Set(
    [
      ...homePoolOptions,
      ...employeesCache.map((employee) => employee.homePool).filter(Boolean),
    ].map((value) => String(value || '').trim()).filter(Boolean)
  );

  createPoolInput.innerHTML = '<option value="">Select facility</option>';
  Array.from(values)
    .sort((a, b) => a.localeCompare(b))
    .forEach((poolName) => {
      const option = document.createElement('option');
      option.value = poolName;
      option.textContent = poolName;
      createPoolInput.appendChild(option);
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
    if (currentView === 'create') setModalView('login');
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
}

function validatePassword(password) {
  if (!password || password.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must include at least 1 number.';
  }
  if (!/[!@#$%^&*()_\-+=[\]{};:'",.<>/?\\|`~]/.test(password)) {
    return 'Password must include at least 1 special character.';
  }
  if (!ALLOWED_PASSWORD_CHARS.test(password)) {
    return 'Password can only include letters, numbers, and standard special characters.';
  }
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
      .map((docSnap) => (docSnap.data()?.name || docSnap.id || '').toString().trim())
      .filter(Boolean);
    populatePoolOptions();
  } catch (err) {
    console.error('Failed to load pools:', err);
  }
}

async function getLifeguardAccount(usernameRaw) {
  const username = normalizeUsername(usernameRaw);
  if (!username) {
    throw new Error('Please enter your username.');
  }
  const accountRef = doc(db, 'lifeguardAccounts', username);
  const accountSnap = await getDoc(accountRef);
  if (!accountSnap.exists()) {
    throw new Error('Username not found. Create an account or contact your supervisor.');
  }
  return { username, ...accountSnap.data() };
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
    await signInWithEmailAndPassword(auth, e, p);
    markSupervisorLoggedIn(e);
  }
}

async function authenticateLifeguard(usernameRaw, passwordRaw) {
  const username = normalizeUsername(usernameRaw);
  const password = passwordRaw || '';
  if (!username || !password) {
    throw new Error('Please enter your username and password.');
  }

  await signInWithEmailAndPassword(auth, buildLifeguardAuthEmail(username), password);
  try {
    const account = await getLifeguardAccount(username);
    const employee =
      employeesCache.find((entry) => entry.email === String(account.employeeEmail || '').toLowerCase()) ||
      normalizeEmployeeRecord({
        email: account.employeeEmail,
        id: account.employeeEmail,
        username,
        firstName: account.firstName,
        lastName: account.lastName,
        homePool: account.homePool,
        phone: account.phone,
      });
    persistLifeguardSession(employee, username);
  } finally {
    await signOut(auth).catch(() => {});
  }
}

async function upsertEmployeeRecord(employee) {
  const normalizedEmployee = normalizeEmployeeRecord(employee);
  const employees = Array.isArray(employeeDocSnapshot) ? [...employeeDocSnapshot] : [];
  const existingIndex = employees.findIndex((entry) => {
    const normalizedEntry = normalizeEmployeeRecord(entry);
    return (
      normalizedEntry.email &&
      normalizedEmployee.email &&
      normalizedEntry.email === normalizedEmployee.email
    );
  });

  const nextRecord = {
    ...(existingIndex >= 0 ? employees[existingIndex] : {}),
    ...normalizedEmployee,
  };

  if (existingIndex >= 0) {
    employees[existingIndex] = nextRecord;
  } else {
    employees.push(nextRecord);
  }

  employeeDocSnapshot = employees;
  employeesCache = employees.map(normalizeEmployeeRecord);
  await setDoc(doc(db, 'settings', 'employees'), { employees }, { merge: true });
}

async function handleSubmit(event) {
  event.preventDefault();
  setMessage(messageEl, '');

  try {
    if (currentRole === 'lifeguard') {
      await authenticateLifeguard(usernameInput.value, passwordInput.value);
    } else {
      await authenticateSupervisor(usernameInput.value, passwordInput.value);
    }

    const path = getDestinationPath();
    closeModal();
    window.location.href = path;
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

  if (!username) {
    setMessage(createMessageEl, 'Please choose a username.', true);
    return;
  }
  if (username.length < 4) {
    setMessage(createMessageEl, 'Usernames must be at least 4 characters long.', true);
    return;
  }
  if (!firstName || !lastName || !email || !homePool || !password || !confirmPassword) {
    setMessage(createMessageEl, 'Please complete every field in the account form.', true);
    return;
  }
  if (!email.includes('@')) {
    setMessage(createMessageEl, 'Please enter a valid email address.', true);
    return;
  }
  if (password !== confirmPassword) {
    setMessage(createMessageEl, 'Passwords do not match.', true);
    return;
  }
  const passwordValidationMessage = validatePassword(password);
  if (passwordValidationMessage) {
    setMessage(createMessageEl, passwordValidationMessage, true);
    return;
  }

  const accountRef = doc(db, 'lifeguardAccounts', username);
  const existingAccount = await getDoc(accountRef);
  if (existingAccount.exists()) {
    setMessage(createMessageEl, 'That username is already taken. Please choose another one.', true);
    return;
  }

  const duplicateEmail = employeesCache.find((employee) => {
    const normalizedEmployee = normalizeEmployeeRecord(employee);
    return normalizedEmployee.email === email && normalizedEmployee.username && normalizedEmployee.username !== username;
  });
  if (duplicateEmail) {
    setMessage(createMessageEl, 'That email is already linked to another username. Please contact your supervisor.', true);
    return;
  }

  try {
    await createUserWithEmailAndPassword(auth, buildLifeguardAuthEmail(username), password);

    const employeeRecord = {
      email,
      id: email,
      username,
      firstName,
      lastName,
      phone,
      homePool,
    };

    await Promise.all([
      setDoc(accountRef, {
        username,
        authEmail: buildLifeguardAuthEmail(username),
        employeeEmail: email,
        firstName,
        lastName,
        phone,
        homePool,
        createdAt: new Date().toISOString(),
      }),
      upsertEmployeeRecord(employeeRecord),
    ]);

    persistLifeguardSession(employeeRecord, username);
    await signOut(auth).catch(() => {});
    closeModal();
    window.location.href = getDestinationPath();
  } catch (err) {
    await signOut(auth).catch(() => {});
    console.error('Create account failed:', err);
    const code = err.code || '';
    const friendly = code === 'auth/email-already-in-use'
      ? 'That username is already in use.'
      : code === 'auth/weak-password'
        ? 'Please choose a stronger password.'
        : code === 'permission-denied'
          ? 'Firebase permissions blocked the account save. Publish the updated Firestore rules, then try again.'
        : (err.message || 'Unable to create your account right now.');
    setMessage(createMessageEl, friendly, true);
  }
}

function wireMenu() {
  document.querySelectorAll('.home-menu-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      openModal(btn.dataset.target);
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
  await Promise.all([loadEmployees(), loadPools()]);
  populatePoolOptions();
  wireMenu();
  wireRoleToggle();

  form?.addEventListener('submit', handleSubmit);
  createAccountForm?.addEventListener('submit', handleCreateAccountSubmit);
  closeBtn?.addEventListener('click', closeModal);
  showCreateAccountBtn?.addEventListener('click', () => setModalView('create'));
  backToLoginBtn?.addEventListener('click', () => setModalView('login'));
  modal?.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });

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
  setModalView('login');
});

window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});
