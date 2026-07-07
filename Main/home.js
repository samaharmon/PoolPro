// home.js – landing page login logic
import { db, auth, doc, getDoc, setDoc, getDocs, collection, deleteDoc, query, orderBy, limit } from '../firebase.js';
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
  desLogbooks: 'des-logbooks/des-logbooks.html',
  operational: 'operational/operational.html',
  resources: 'resources/resources.html',
  supervisor: 'chem/chem.html#supervisorDashboard'
};

const ACCESS_MODE_STORAGE_KEY = 'poolproAccessMode';
const ACCESS_MODES = new Set(['attendant', 'lifeguard', 'manager', 'supervisor']);
const ROLE_PERMISSIONS_STORAGE_KEY = 'poolproRolePermissionsProfile';
const ROLE_PERMISSIONS_DOC_ID = 'rolesPermissions';
const SITE_DEVELOPER_EMAIL = 'samaharmon@icloud.com';
const ROLE_STORAGE_KEY = 'chemlogRole';
const VERIFY_CONTEXT_KEY = 'poolproPendingLifeguardVerification';
const VERIFY_WINDOW_MS = 6 * 60 * 60 * 1000;
const LIFEGUARD_SESSION_KEY = 'poolproLifeguardSession';
const LIFEGUARD_SESSION_VERIFICATION_VERSION = 2;
const SUPERVISOR_SESSION_VERIFICATION_VERSION = 1;
const VERIFY_EMAIL_RESEND_MS = 60 * 1000;
const HOME_POOL_OPTIONS_CACHE_KEY = 'poolproHomeFacilityOptions';
const HOME_POOL_LOAD_WAIT_MS = 3500;
const ALLOWED_PASSWORD_CHARS = /^[A-Za-z0-9!@#$%^&*()_\-+=[\]{};:'",.<>/?\\|`~]+$/;
const EMAIL_AUTH_MODE_VERIFY = 'verifyEmail';
const DEVICE_VERIFIED_KEY = 'poolproDeviceVerified';
const LOGIN_ATTEMPT_STORAGE_KEY = 'poolproLoginAttempts';
const LOGIN_ATTEMPT_DOC_PREFIX = 'loginAttempt__';
const MAX_LOGIN_ATTEMPTS = 3;
const LOGIN_ATTEMPT_LOCKOUT_MS = 15 * 60 * 1000;
const CLEANLINESS_REMINDER_START_HOUR = 18;
const CLEANLINESS_REMINDER_END_HOUR = 21;
const CLEANLINESS_REMINDER_RECENT_MS = 3 * 60 * 60 * 1000;
const CLEANLINESS_REMINDER_QUERY_LIMIT = 200;
const CLEANLINESS_REMINDER_MESSAGE = 'DO NOT FORGET to fill out the Cleanliness Report at the end of your shift.';
const ROLE_DEFINITIONS = [
  { key: 'lifeguard', label: 'Lifeguard' },
  { key: 'attendant', label: 'Attendant' },
  { key: 'poolManager', label: 'Pool Manager' },
  { key: 'supervisor', label: 'Supervisor' },
];
const PERMISSION_DEFINITIONS = [
  { key: 'poolChemistryLog', label: 'Pool Chemistry Log' },
  { key: 'trainingSignup', label: 'Training Signup' },
  { key: 'cleanlinessReport', label: 'Cleanliness Report' },
  { key: 'desLogbooks', label: 'DES Logbook Report' },
  { key: 'managerialReport', label: 'Chemical Inventory Log' },
  { key: 'operationalStatusLog', label: 'Operational Status Log' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'todoList', label: 'To Do List' },
  { key: 'resources', label: 'Resources' },
  { key: 'desPreInspection', label: 'DES Pre-Inspection' },
  { key: 'poolChemistryDashboard', label: 'Pool Chemistry Dashboard' },
  { key: 'trainingSetup', label: 'Training Setup' },
  { key: 'performanceTracking', label: 'Performance Tracking' },
  { key: 'auditingForms', label: 'Auditing Forms' },
  { key: 'rulesEditor', label: 'Rules Editor' },
  { key: 'settings', label: 'Settings' },
];
const ROLE_DEFAULT_PERMISSIONS = {
  lifeguard: {
    poolChemistryLog: true,
    trainingSignup: true,
    cleanlinessReport: true,
    desLogbooks: false,
    managerialReport: false,
    operationalStatusLog: true,
    inventory: true,
    todoList: true,
    resources: true,
    desPreInspection: false,
    poolChemistryDashboard: false,
    trainingSetup: false,
    performanceTracking: false,
    auditingForms: false,
    rulesEditor: false,
    settings: true,
  },
  attendant: {
    poolChemistryLog: true,
    trainingSignup: false,
    cleanlinessReport: false,
    desLogbooks: true,
    managerialReport: false,
    operationalStatusLog: true,
    inventory: true,
    todoList: true,
    resources: true,
    desPreInspection: false,
    poolChemistryDashboard: false,
    trainingSetup: false,
    performanceTracking: false,
    auditingForms: false,
    rulesEditor: false,
    settings: true,
  },
  poolManager: {
    poolChemistryLog: true,
    trainingSignup: true,
    cleanlinessReport: true,
    desLogbooks: false,
    managerialReport: true,
    operationalStatusLog: true,
    inventory: true,
    todoList: true,
    resources: true,
    desPreInspection: true,
    poolChemistryDashboard: false,
    trainingSetup: false,
    performanceTracking: false,
    auditingForms: false,
    rulesEditor: false,
    settings: true,
  },
  supervisor: Object.fromEntries(PERMISSION_DEFINITIONS.map(({ key }) => [key, true])),
};
const HOME_ROLES_PERMISSIONS_EMPTY = {
  roles: Object.fromEntries(ROLE_DEFINITIONS.map(({ key }) => [key, []])),
  permissions: ROLE_DEFAULT_PERMISSIONS,
  individualPermissions: {},
};

let pendingTarget = null;
let currentRole = 'lifeguard';
let currentView = 'login';
let employeesCache = [];
let employeeDocSnapshot = [];
let homePoolOptions = [];
let homeRolesPermissionsData = HOME_ROLES_PERMISSIONS_EMPTY;
let pendingVerification = null;
let profileCompletionContext = null;
let verifyCooldownUntil = 0;
let verifyCooldownTimer = null;
let verifyStatusPoller = null;
let createAccountSubmitting = false;
let lastHomeMenuActivationAt = 0;
let homeMenuPointerActivationAt = 0;
let homeMenuActionPending = false;
let cleanlinessReminderModal = null;
let loginSubmitting = false;
let loginSubmitTouchAt = 0;
let modalOpenedAt = 0;
let homeModalControlsBound = false;

const modal = document.getElementById('homeLoginModal');
const closeBtn = document.getElementById('homeLoginClose');
const modalTitle = document.getElementById('homeModalTitle');
const form = document.getElementById('homeLoginForm');
const loginSubmitBtn = document.getElementById('homeLoginSubmit');
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

function normalizeAccessMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return ACCESS_MODES.has(mode) ? mode : 'lifeguard';
}

function persistAccessMode(mode) {
  const normalized = normalizeAccessMode(mode);
  try {
    localStorage.setItem(ACCESS_MODE_STORAGE_KEY, normalized);
    sessionStorage.setItem(ACCESS_MODE_STORAGE_KEY, normalized);
  } catch (err) {
    console.warn('Could not persist PoolPro access mode:', err);
  }
  return normalized;
}

function getAccessModeLabel(mode = currentRole) {
  const normalized = normalizeAccessMode(mode);
  if (normalized === 'supervisor') return 'Supervisor';
  if (normalized === 'manager') return 'Manager';
  if (normalized === 'attendant') return 'Gate Attendant';
  return 'Lifeguard';
}

function normalizePermissionMap(source = {}, roleKey = '') {
  const defaults = ROLE_DEFAULT_PERMISSIONS[roleKey] || {};
  const legacyKeys = new Set(['poolChemistryDashboard', 'managerialReport', 'desPreInspection']);
  const hasExpandedPermissionShape = PERMISSION_DEFINITIONS.some(({ key }) =>
    !legacyKeys.has(key) && Object.prototype.hasOwnProperty.call(source || {}, key)
  );
  if (roleKey === 'supervisor' && !hasExpandedPermissionShape) {
    return { ...defaults };
  }
  return Object.fromEntries(PERMISSION_DEFINITIONS.map(({ key }) => [
    key,
    Object.prototype.hasOwnProperty.call(source || {}, key) ? !!source[key] : !!defaults[key],
  ]));
}

function normalizeRolesPermissionsData(data = {}) {
  const roles = data.roles || {};
  const permissions = data.permissions || {};
  const individual = data.individualPermissions || {};
  const normalizedIndividual = Object.fromEntries(Object.entries(individual).map(([key, value]) => {
    const normalized = {};
    PERMISSION_DEFINITIONS.forEach(({ key: permissionKey }) => {
      if (Object.prototype.hasOwnProperty.call(value || {}, permissionKey)) {
        normalized[permissionKey] = !!value[permissionKey];
      }
    });
    return [normalizeIdentityKey(key), normalized];
  }));
  return {
    roles: Object.fromEntries(ROLE_DEFINITIONS.map(({ key }) => [
      key,
      Array.isArray(roles[key]) ? roles[key].map(normalizeIdentityKey).filter(Boolean) : [],
    ])),
    permissions: Object.fromEntries(ROLE_DEFINITIONS.map(({ key }) => [
      key,
      normalizePermissionMap(permissions[key], key),
    ])),
    individualPermissions: normalizedIndividual,
  };
}

function normalizeIdentityKey(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeFacilityName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function timestampToMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value.seconds === 'number') {
    return (value.seconds * 1000) + Math.floor(Number(value.nanoseconds || 0) / 1000000);
  }
  return 0;
}

function isSameLocalDay(firstMs, secondMs) {
  if (!firstMs || !secondMs) return false;
  const first = new Date(firstMs);
  const second = new Date(secondMs);
  return first.getFullYear() === second.getFullYear()
    && first.getMonth() === second.getMonth()
    && first.getDate() === second.getDate();
}

function isCleanlinessReminderWindow(now = new Date()) {
  const hour = now.getHours();
  return hour >= CLEANLINESS_REMINDER_START_HOUR && hour < CLEANLINESS_REMINDER_END_HOUR;
}

function ensureCleanlinessReminderModal() {
  if (cleanlinessReminderModal) return cleanlinessReminderModal;
  const modalEl = document.createElement('div');
  modalEl.id = 'homeCleanlinessReminderModal';
  modalEl.className = 'home-cleanliness-reminder-modal';
  modalEl.innerHTML = `
    <div class="home-cleanliness-reminder-card" role="alertdialog" aria-modal="true" aria-describedby="homeCleanlinessReminderText">
      <p id="homeCleanlinessReminderText">${CLEANLINESS_REMINDER_MESSAGE}</p>
      <button type="button" class="submit-btn" id="homeCleanlinessReminderOk">OK</button>
    </div>
  `;
  document.body.appendChild(modalEl);
  cleanlinessReminderModal = modalEl;
  return cleanlinessReminderModal;
}

function showCleanlinessReminderModal() {
  return new Promise((resolve) => {
    const modalEl = ensureCleanlinessReminderModal();
    const okBtn = modalEl.querySelector('#homeCleanlinessReminderOk');

    const close = () => {
      okBtn?.removeEventListener('click', close);
      modalEl.classList.remove('visible');
      setTimeout(() => {
        if (!modalEl.classList.contains('visible')) modalEl.style.display = 'none';
        resolve();
      }, 180);
    };

    okBtn?.addEventListener('click', close);
    modalEl.style.display = 'flex';
    requestAnimationFrame(() => {
      modalEl.classList.add('visible');
      okBtn?.focus();
    });
  });
}

async function hasRecentCleanlinessReportForPool(poolName) {
  const normalizedPool = normalizeFacilityName(poolName);
  if (!normalizedPool) return false;

  const nowMs = Date.now();
  const recentCutoffMs = nowMs - CLEANLINESS_REMINDER_RECENT_MS;

  try {
    const reportsQuery = query(
      collection(db, 'dutySubmissions'),
      orderBy('timestamp', 'desc'),
      limit(CLEANLINESS_REMINDER_QUERY_LIMIT)
    );
    const snap = await getDocs(reportsQuery);
    return snap.docs.some((docSnap) => {
      const report = docSnap.data() || {};
      const submittedMs = timestampToMillis(report.timestamp);
      if (!submittedMs || submittedMs < recentCutoffMs) return false;
      if (!isSameLocalDay(submittedMs, nowMs)) return false;
      return normalizeFacilityName(report.pool) === normalizedPool;
    });
  } catch (err) {
    console.warn('Could not check recent cleanliness reports:', err);
    return false;
  }
}

async function maybeShowCleanlinessReminder(homePool) {
  if (!isCleanlinessReminderWindow()) return;
  if (!normalizeFacilityName(homePool)) return;
  if (await hasRecentCleanlinessReportForPool(homePool)) return;
  await showCleanlinessReminderModal();
}

async function maybeShowLifeguardCleanlinessReminder(accessMode, homePool) {
  if (normalizeAccessMode(accessMode) !== 'lifeguard') return;
  await maybeShowCleanlinessReminder(homePool);
}

async function loadHomeRolesPermissions() {
  try {
    const snap = await getDoc(doc(db, 'settings', ROLE_PERMISSIONS_DOC_ID));
    homeRolesPermissionsData = normalizeRolesPermissionsData(snap.exists() ? snap.data() : {});
  } catch (err) {
    console.error('Failed to load home roles and permissions:', err);
    homeRolesPermissionsData = normalizeRolesPermissionsData({});
  }
  return homeRolesPermissionsData;
}

function getEffectivePermissionsForKeys(keys) {
  const normalizedKeys = new Set((keys || []).map(normalizeIdentityKey).filter(Boolean));
  const effective = normalizePermissionMap();
  ROLE_DEFINITIONS.forEach(({ key: roleKey }) => {
    const members = homeRolesPermissionsData.roles?.[roleKey] || [];
    if (!members.some((memberKey) => normalizedKeys.has(memberKey))) return;
    Object.entries(homeRolesPermissionsData.permissions?.[roleKey] || {}).forEach(([permissionKey, enabled]) => {
      if (enabled) effective[permissionKey] = true;
    });
  });
  Object.keys(effective).forEach((permissionKey) => {
    const overrides = Array.from(normalizedKeys)
      .map((identityKey) => homeRolesPermissionsData.individualPermissions?.[identityKey])
      .filter((individual) => Object.prototype.hasOwnProperty.call(individual || {}, permissionKey))
      .map((individual) => !!individual[permissionKey]);
    if (overrides.includes(false)) effective[permissionKey] = false;
    else if (overrides.includes(true)) effective[permissionKey] = true;
  });
  return effective;
}

function hasRoleMembership(keys, roleKey) {
  const normalizedKeys = new Set((keys || []).map(normalizeIdentityKey).filter(Boolean));
  return (homeRolesPermissionsData.roles?.[roleKey] || []).some((memberKey) => normalizedKeys.has(memberKey));
}

function hasAnyExplicitRole(keys) {
  return ROLE_DEFINITIONS.some(({ key }) => hasRoleMembership(keys, key));
}

function isDeveloperKey(keys) {
  return (keys || []).map(normalizeIdentityKey).includes(SITE_DEVELOPER_EMAIL);
}

function getIdentityKeysForAccount(account, username) {
  return [
    account?.employeeEmail,
    account?.authEmail,
    account?.email,
    account?.id,
    account?.username,
    username,
  ].map(normalizeIdentityKey).filter(Boolean);
}

function getIdentityKeysForSupervisor(email) {
  const authEmail = normalizeIdentityKey(auth.currentUser?.email);
  return [email, authEmail].map(normalizeIdentityKey).filter(Boolean);
}

function getStoredSupervisorEmail() {
  try {
    const token = JSON.parse(localStorage.getItem('loginToken') || 'null');
    return normalizeIdentityKey(token?.username);
  } catch (_) {
    return '';
  }
}

function cacheHomeAccessProfile(keys) {
  const normalizedKeys = (keys || []).map(normalizeIdentityKey).filter(Boolean);
  const permissions = getEffectivePermissionsForKeys(normalizedKeys);
  if (isDeveloperKey(normalizedKeys)) {
    Object.keys(permissions).forEach((permissionKey) => {
      permissions[permissionKey] = true;
    });
  }
  try {
    localStorage.setItem(ROLE_PERMISSIONS_STORAGE_KEY, JSON.stringify({
      isDeveloper: isDeveloperKey(normalizedKeys),
      permissions,
    }));
  } catch (_) { /* ignore */ }
}

async function assertAccessModeAllowed(mode, keys) {
  const requestedMode = normalizeAccessMode(mode);
  const normalizedKeys = (keys || []).map(normalizeIdentityKey).filter(Boolean);
  await loadHomeRolesPermissions();
  const developer = isDeveloperKey(normalizedKeys);
  const supervisorMember = hasRoleMembership(normalizedKeys, 'supervisor');
  const managerMember = hasRoleMembership(normalizedKeys, 'poolManager');
  const attendantMember = hasRoleMembership(normalizedKeys, 'attendant');
  const lifeguardMember = hasRoleMembership(normalizedKeys, 'lifeguard');
  const explicitRole = hasAnyExplicitRole(normalizedKeys);
  const permissions = getEffectivePermissionsForKeys(normalizedKeys);
  const hasManagerPermission = !!(permissions.managerialReport || permissions.desPreInspection);

  if (requestedMode === 'lifeguard') {
    if (developer || supervisorMember || managerMember || lifeguardMember || !explicitRole) {
      cacheHomeAccessProfile(normalizedKeys);
      return;
    }
    throw new Error('This account does not have lifeguard access.');
  }

  if (requestedMode === 'attendant') {
    if (developer || supervisorMember || managerMember || attendantMember) {
      cacheHomeAccessProfile(normalizedKeys);
      return;
    }
    throw new Error('This account does not have gate attendant access.');
  }

  if (requestedMode === 'supervisor') {
    if (developer || supervisorMember) {
      cacheHomeAccessProfile(normalizedKeys);
      return;
    }
    throw new Error('This account does not have supervisor access.');
  }

  if (developer || supervisorMember || managerMember || hasManagerPermission) {
    cacheHomeAccessProfile(normalizedKeys);
    return;
  }
  throw new Error('This account does not have manager access.');
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

function hasEmailVerificationOverride(account) {
  return account?.emailVerificationOverride === true;
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
    role: account?.role || '',
    createdAt: account?.createdAt || '',
    lastVerifiedAt: account?.lastVerifiedAt || '',
    emailVerificationOverride: account?.emailVerificationOverride === true,
    emailVerificationOverrideAt: account?.emailVerificationOverrideAt || '',
    emailVerificationOverrideBy: account?.emailVerificationOverrideBy || '',
  });
}

function mergeEmployeeProfiles(...sources) {
  return normalizeEmployeeRecord(sources.reduce((merged, source) => {
    const normalized = normalizeEmployeeRecord(source || {});
    Object.entries(normalized).forEach(([key, value]) => {
      const cleanValue = String(value ?? '').trim();
      if (cleanValue) merged[key] = value;
    });
    return merged;
  }, {}));
}

function findEmployeeForAccount(account, username = '') {
  const keys = [
    account?.employeeEmail,
    account?.authEmail,
    account?.email,
    account?.id,
    account?.username,
    username,
  ].map(normalizeIdentityKey).filter(Boolean);
  return employeesCache.find((entry) => {
    const employee = normalizeEmployeeRecord(entry);
    return [
      employee.email,
      employee.id,
      employee.username,
    ].map(normalizeIdentityKey).some((key) => key && keys.includes(key));
  }) || null;
}

function getMissingEmployeeProfileFields(employee) {
  const normalized = normalizeEmployeeRecord(employee || {});
  const required = [
    ['username', normalized.username],
    ['first name', normalized.firstName],
    ['last name', normalized.lastName],
    ['email', normalized.email],
    ['phone number', normalized.phone],
    ['home facility', normalized.homePool],
  ];
  return required.filter(([, value]) => !String(value || '').trim()).map(([label]) => label);
}

function restoreCreateAccountMode() {
  createUsernameInput?.removeAttribute('disabled');
  createEmailInput?.removeAttribute('disabled');
  [createPasswordInput, createConfirmPasswordInput].forEach((input) => {
    input?.closest('.form-group')?.classList.remove('hidden');
    if (input) {
      input.disabled = false;
      input.required = false;
    }
  });
  if (backToLoginBtn) backToLoginBtn.textContent = 'Back to Sign In';
}

function configureProfileCompletionForm({ username, account, employee, target, accessMode }) {
  profileCompletionContext = {
    username: normalizeUsername(username || account?.username || employee?.username || ''),
    account,
    target: sanitizeTarget(target || getDestinationPath()),
    accessMode: normalizeAccessMode(accessMode || currentRole),
  };
  const merged = mergeEmployeeProfiles(buildEmployeeFromAccount(account), employee, {
    username: profileCompletionContext.username,
  });

  if (createUsernameInput) {
    createUsernameInput.value = profileCompletionContext.username || merged.username || '';
    createUsernameInput.disabled = true;
  }
  if (createFirstNameInput) createFirstNameInput.value = merged.firstName || '';
  if (createLastNameInput) createLastNameInput.value = merged.lastName || '';
  if (createEmailInput) {
    createEmailInput.value = merged.email || getAuthEmail(account) || '';
    createEmailInput.disabled = true;
  }
  if (createPhoneInput) createPhoneInput.value = merged.phone || '';
  setCreatePoolValue(merged.homePool || '');
  [createPasswordInput, createConfirmPasswordInput].forEach((input) => {
    input?.closest('.form-group')?.classList.add('hidden');
    if (input) {
      input.value = '';
      input.disabled = true;
    }
  });
  if (backToLoginBtn) backToLoginBtn.textContent = 'Return to Login';
}

function openProfileCompletionView(context) {
  configureProfileCompletionForm(context);
  setModalView('create');
  setMessage(
    createMessageEl,
    'Complete your account information before opening PoolPro.'
  );
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

function normalizeLoginAttemptIdentifier(identifier) {
  return String(identifier || '').trim().toLowerCase();
}

function getLoginAttemptKey(role, identifier) {
  const normalizedIdentifier = normalizeLoginAttemptIdentifier(identifier);
  return normalizedIdentifier ? `${role}:${normalizedIdentifier}` : '';
}

function clearLegacyLoginAttemptState(role, identifier) {
  const key = getLoginAttemptKey(role, identifier);
  if (!key) return;
  try {
    const raw = localStorage.getItem(LOGIN_ATTEMPT_STORAGE_KEY);
    if (!raw) return;
    const store = JSON.parse(raw);
    if (!store || typeof store !== 'object' || !store[key]) return;
    delete store[key];
    localStorage.setItem(LOGIN_ATTEMPT_STORAGE_KEY, JSON.stringify(store));
  } catch (_) {
    // Ignore stale local lock data cleanup errors.
  }
}

function getLoginAttemptDocId(role, identifier) {
  const key = getLoginAttemptKey(role, identifier);
  if (!key) return '';
  return `${LOGIN_ATTEMPT_DOC_PREFIX}${key.replace(/[^a-z0-9._:-]+/gi, '_')}`;
}

function getLoginAttemptDocRef(role, identifier) {
  const docId = getLoginAttemptDocId(role, identifier);
  return docId ? doc(db, 'settings', docId) : null;
}

function formatLoginLockoutMessage(waitMs) {
  const remainingMinutes = Math.max(1, Math.ceil(Number(waitMs || 0) / 60000));
  return `Too many login attempts. Wait ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}, then try again. If you get locked out again after 3 tries, notify the developer.`;
}

function createLoginLockoutError(waitMs) {
  const err = new Error(formatLoginLockoutMessage(waitMs));
  err.code = 'poolpro/too-many-login-attempts';
  return err;
}

async function getLoginAttemptState(role, identifier) {
  const ref = getLoginAttemptDocRef(role, identifier);
  if (!ref) {
    return { ref: null, count: 0, lastFailedAt: 0, blockedUntil: 0 };
  }

  const now = Date.now();
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      clearLegacyLoginAttemptState(role, identifier);
      return { ref, count: 0, lastFailedAt: 0, blockedUntil: 0 };
    }

    const rawState = snap.data() || {};
    const count = Number(rawState.count || 0);
    const lastFailedAt = Number(rawState.lastFailedAt || 0);
    const blockedUntil = Number(rawState.blockedUntil || 0);
    const shouldReset =
      !count ||
      (blockedUntil && now >= blockedUntil) ||
      (lastFailedAt && (now - lastFailedAt) >= LOGIN_ATTEMPT_LOCKOUT_MS);

    if (shouldReset) {
      await deleteDoc(ref).catch(() => {});
      clearLegacyLoginAttemptState(role, identifier);
      return { ref, count: 0, lastFailedAt: 0, blockedUntil: 0 };
    }

    clearLegacyLoginAttemptState(role, identifier);
    return { ref, count, lastFailedAt, blockedUntil };
  } catch (err) {
    console.warn('Could not read login attempt state:', err);
    return { ref, count: 0, lastFailedAt: 0, blockedUntil: 0 };
  }
}

async function assertLoginAttemptsRemaining(role, identifier) {
  const state = await getLoginAttemptState(role, identifier);
  if (!state.ref) return;

  const now = Date.now();
  if (state.blockedUntil && state.blockedUntil > now) {
    throw createLoginLockoutError(state.blockedUntil - now);
  }
}

async function recordLoginFailure(role, identifier, options = {}) {
  const { lockImmediately = false } = options;
  const state = await getLoginAttemptState(role, identifier);
  if (!state.ref) {
    return { count: 0, lastFailedAt: 0, blockedUntil: 0 };
  }

  const now = Date.now();
  const nextCount = lockImmediately
    ? MAX_LOGIN_ATTEMPTS
    : Math.min(MAX_LOGIN_ATTEMPTS, Number(state.count || 0) + 1);
  const blockedUntil = nextCount >= MAX_LOGIN_ATTEMPTS ? now + LOGIN_ATTEMPT_LOCKOUT_MS : 0;
  const nextState = {
    count: nextCount,
    lastFailedAt: now,
    blockedUntil,
  };
  try {
    await setDoc(state.ref, nextState, { merge: true });
  } catch (err) {
    console.warn('Could not persist login attempt state:', err);
  }
  clearLegacyLoginAttemptState(role, identifier);
  return nextState;
}

async function clearLoginFailures(role, identifier) {
  const ref = getLoginAttemptDocRef(role, identifier);
  if (!ref) return;
  try {
    await deleteDoc(ref);
  } catch (err) {
    console.warn('Could not clear login attempt state:', err);
  }
  clearLegacyLoginAttemptState(role, identifier);
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

function buildVerificationActionUrl({ username, target, emailAuthMode, accessMode }) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('username', normalizeUsername(username));
  url.searchParams.set('target', sanitizeTarget(target));
  if (emailAuthMode) url.searchParams.set('authMode', emailAuthMode);
  if (accessMode) url.searchParams.set('accessMode', normalizeAccessMode(accessMode));
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
  createSubmitBtn.textContent = isSubmitting
    ? (profileCompletionContext ? 'Saving...' : 'Creating...')
    : 'Save Info';
}

function setLoginSubmitting(isSubmitting) {
  loginSubmitting = isSubmitting;
  if (!loginSubmitBtn) return;
  loginSubmitBtn.disabled = isSubmitting;
  loginSubmitBtn.textContent = isSubmitting ? 'Continuing...' : 'Continue';
  loginSubmitBtn.classList.toggle('is-loading', isSubmitting);
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
    verifyHintEl.textContent = 'Check spam after 60 seconds. Resend if needed.';
  }
  if (verifyResendBtn) verifyResendBtn.textContent = 'Resend Verification';
  verifyCooldownUntil = 0;
  updateVerifyCooldownUi();
  stopVerifyCooldownTimer();
}

function resetForms() {
  profileCompletionContext = null;
  restoreCreateAccountMode();
  form?.reset();
  createAccountForm?.reset();
  document.querySelectorAll('[data-password-toggle]').forEach((button) => {
    const input = document.getElementById(button.dataset.passwordToggle);
    if (input) input.type = 'password';
    button.classList.remove('is-visible');
    button.setAttribute('aria-label', 'Show password');
    button.setAttribute('aria-pressed', 'false');
  });
  if (createPoolInput) delete createPoolInput.dataset.pendingValue;
  verifyForm?.reset();
  resetVerificationState();
  clearMessages();
}

function setModalView(view) {
  if (view !== 'create' && profileCompletionContext) {
    profileCompletionContext = null;
    restoreCreateAccountMode();
  }
  currentView = view;
  form?.classList.toggle('hidden', view !== 'login');
  createAccountForm?.classList.toggle('hidden', view !== 'create');
  verifyForm?.classList.toggle('hidden', view !== 'verify');
  resetPasswordForm?.classList.toggle('hidden', view !== 'reset');
  updateFirstTimeCallout();

  if (modalTitle) {
    modalTitle.textContent = view === 'create'
      ? (profileCompletionContext ? 'Complete Account Info' : 'Create Account')
      : view === 'verify'
        ? 'Verify Identity'
        : view === 'reset'
          ? 'Reset Password'
          : `${getAccessModeLabel()} Sign In`;
  }

  if (view === 'reset') {
    const isSupervisorLogin = currentRole === 'supervisor';
    const isManagerLogin = currentRole === 'manager';
    if (resetFieldLabel) resetFieldLabel.textContent = isSupervisorLogin ? 'Email' : 'Username or Email';
    if (resetCopyEl) resetCopyEl.textContent = isSupervisorLogin
      ? 'Enter your email address and we\'ll send you a link to reset your password.'
      : isManagerLogin
        ? 'Enter your username or email and we\'ll send a password reset link to your registered email.'
        : 'Enter your username or email and we\'ll send a password reset link to your registered email.';
    if (resetFieldInput) {
      resetFieldInput.type = isSupervisorLogin ? 'email' : 'text';
      resetFieldInput.autocomplete = isSupervisorLogin ? 'email' : 'username';
      resetFieldInput.focus();
    }
    setMessage(resetMessageEl, '');
  }

  if (view === 'create') {
    populatePoolOptions({ loading: !homePoolOptions.length && !loadCachedHomePoolOptions().length });
    if (!profileCompletionContext) restoreCreateAccountMode();
    (profileCompletionContext ? createFirstNameInput : createUsernameInput)?.focus();
  }
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
  if (pendingTarget && DESTINATIONS[pendingTarget]) return DESTINATIONS[pendingTarget];
  const storedMode = normalizeAccessMode(
    sessionStorage.getItem(ACCESS_MODE_STORAGE_KEY) ||
    localStorage.getItem(ACCESS_MODE_STORAGE_KEY) ||
    currentRole
  );
  return storedMode === 'supervisor' ? DESTINATIONS.supervisor : DESTINATIONS.chem;
}

function normalizeHomePoolOption(raw) {
  if (!raw) return null;
  const name = (
    typeof raw === 'string'
      ? raw
      : raw.name || raw.facilityName || raw.poolName || raw.id || ''
  ).toString().trim();
  if (!name) return null;
  const rawMarkets = typeof raw === 'string'
    ? []
    : (Array.isArray(raw.markets) ? raw.markets : (raw.market ? [raw.market] : []));
  const markets = rawMarkets
    .map((market) => String(market || '').trim())
    .filter(Boolean);
  return { name, markets };
}

function mergeHomePoolOptions(...sources) {
  const merged = new Map();
  sources.flat().forEach((item) => {
    const option = normalizeHomePoolOption(item);
    if (!option) return;
    const key = normalizeFacilityName(option.name);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, option);
      return;
    }
    const existingMarkets = new Set(existing.markets || []);
    option.markets.forEach((market) => existingMarkets.add(market));
    existing.markets = Array.from(existingMarkets);
  });
  return Array.from(merged.values()).sort((a, b) => {
    const marketA = (a.markets?.[0] || 'Other').localeCompare(b.markets?.[0] || 'Other');
    return marketA || a.name.localeCompare(b.name);
  });
}

function getEmployeeHomePoolOptions() {
  return employeesCache
    .map((employee) => normalizeHomePoolOption({ name: employee.homePool, markets: ['Other'] }))
    .filter(Boolean);
}

function loadCachedHomePoolOptions() {
  try {
    const cached = JSON.parse(localStorage.getItem(HOME_POOL_OPTIONS_CACHE_KEY) || '[]');
    return Array.isArray(cached) ? cached.map(normalizeHomePoolOption).filter(Boolean) : [];
  } catch (_) {
    return [];
  }
}

function cacheHomePoolOptions(options) {
  const normalized = mergeHomePoolOptions(options).filter((option) => option.name);
  if (!normalized.length) return;
  try {
    localStorage.setItem(HOME_POOL_OPTIONS_CACHE_KEY, JSON.stringify(normalized));
  } catch (_) {
    // A missing local cache should never block account creation.
  }
}

function groupHomePoolOptionsByMarket(options) {
  const groups = new Map();
  options.forEach((pool) => {
    const market = String(pool.markets?.[0] || 'Other').trim() || 'Other';
    if (!groups.has(market)) groups.set(market, []);
    groups.get(market).push(pool);
  });
  return Array.from(groups.entries())
    .sort(([marketA], [marketB]) => marketA.localeCompare(marketB))
    .map(([market, pools]) => ({
      market,
      pools: pools.sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

function setCreatePoolValue(value) {
  if (!createPoolInput) return;
  const cleanValue = String(value || '').trim();
  if (cleanValue) createPoolInput.dataset.pendingValue = cleanValue;
  createPoolInput.value = cleanValue;
}

function populatePoolOptions({ loading = false } = {}) {
  if (!createPoolInput) return;
  const currentValue = createPoolInput.value || createPoolInput.dataset.pendingValue || '';
  createPoolInput.innerHTML = '<option value="">Select facility</option>';

  const cachedOptions = homePoolOptions.length ? [] : loadCachedHomePoolOptions();
  const facilityOptions = mergeHomePoolOptions(
    homePoolOptions,
    getEmployeeHomePoolOptions(),
    cachedOptions
  );
  const hasCurrentValue = currentValue && facilityOptions.some((option) => option.name === currentValue);
  if (currentValue && !hasCurrentValue) {
    facilityOptions.push({ name: currentValue, markets: ['Current selection'] });
  }

  groupHomePoolOptionsByMarket(facilityOptions).forEach(({ market, pools }) => {
    const group = document.createElement('optgroup');
    group.label = market;
    pools.forEach((pool) => {
      const option = document.createElement('option');
      option.value = pool.name;
      option.textContent = pool.name;
      option.dataset.market = market;
      group.appendChild(option);
    });
    createPoolInput.appendChild(group);
  });

  if (!facilityOptions.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = loading ? 'Loading facilities...' : 'Facilities could not load. Refresh and try again.';
    option.disabled = true;
    createPoolInput.appendChild(option);
  }

  createPoolInput.disabled = false;
  createPoolInput.classList.toggle('is-loading', !!loading && !facilityOptions.length);
  if (currentValue) {
    createPoolInput.value = currentValue;
    if (createPoolInput.value === currentValue) delete createPoolInput.dataset.pendingValue;
  }
}

function persistLifeguardSession(employee, username, accessMode = 'lifeguard') {
  const normalizedEmployee = normalizeEmployeeRecord(employee);
  const normalizedAccessMode = persistAccessMode(accessMode);
  const session = {
    role: 'lifeguard',
    accessMode: normalizedAccessMode,
    emailVerified: true,
    verificationVersion: LIFEGUARD_SESSION_VERIFICATION_VERSION,
    verifiedAt: new Date().toISOString(),
    email: normalizedEmployee.email || '',
    employeeId: normalizedEmployee.email || normalizedEmployee.id || '',
    username: normalizeUsername(username || normalizedEmployee.username || ''),
    firstName: normalizedEmployee.firstName || '',
    lastName: normalizedEmployee.lastName || '',
    homePool: normalizedEmployee.homePool || '',
    phone: normalizedEmployee.phone || '',
    expires: Date.now() + VERIFY_WINDOW_MS,
  };
  sessionStorage.setItem('chemlogRole', 'lifeguard');
  sessionStorage.setItem('chemlogEmployeeEmail', session.email);
  sessionStorage.setItem('chemlogEmployeeId', session.employeeId);
  sessionStorage.setItem('chemlogEmployeeUsername', session.username);
  sessionStorage.setItem('chemlogEmployeeFirstName', session.firstName);
  sessionStorage.setItem('chemlogEmployeeLastName', session.lastName);
  sessionStorage.setItem('chemlogEmployeeHomePool', session.homePool);
  sessionStorage.setItem('chemlogEmployeePhone', session.phone);
  sessionStorage.setItem(ACCESS_MODE_STORAGE_KEY, normalizedAccessMode);
  localStorage.setItem(ROLE_STORAGE_KEY, 'lifeguard');
  localStorage.setItem(ACCESS_MODE_STORAGE_KEY, normalizedAccessMode);
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
  sessionStorage.removeItem(ACCESS_MODE_STORAGE_KEY);
  localStorage.removeItem(ROLE_STORAGE_KEY);
  localStorage.removeItem(ACCESS_MODE_STORAGE_KEY);
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
    const verified =
      token?.emailVerified === true &&
      Number(token?.verificationVersion || 0) >= SUPERVISOR_SESSION_VERIFICATION_VERSION;
    if (token?.expires && Date.now() < Number(token.expires) && verified) return true;
    if (token?.expires && Date.now() >= Number(token.expires)) clearSupervisorSession();
    if (token?.expires && !verified) clearSupervisorSession();
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
  localStorage.removeItem(ACCESS_MODE_STORAGE_KEY);
  sessionStorage.removeItem(ACCESS_MODE_STORAGE_KEY);
}

function buildLifeguardAgreementContext(account, username, accessMode = 'lifeguard') {
  return {
    role: normalizeAccessMode(accessMode),
    email: (account?.employeeEmail || account?.authEmail || '').toString().trim().toLowerCase(),
    username: normalizeUsername(username || account?.username || ''),
    firstName: (account?.firstName || '').toString().trim(),
    lastName: (account?.lastName || '').toString().trim(),
    displayName: `${account?.firstName || ''} ${account?.lastName || ''}`.trim(),
    employeeId: (account?.employeeEmail || account?.authEmail || '').toString().trim().toLowerCase(),
  };
}

function buildSupervisorAgreementContext(email, accessMode = 'supervisor') {
  const user = auth.currentUser;
  return {
    role: normalizeAccessMode(accessMode),
    email: (user?.email || email || '').toString().trim().toLowerCase(),
    username: (user?.email || email || '').toString().trim().toLowerCase(),
    displayName: (user?.displayName || '').toString().trim(),
    employeeId: (user?.email || email || '').toString().trim().toLowerCase(),
  };
}

function getEmployeeHomePoolByEmail(email) {
  const normalizedEmail = normalizeIdentityKey(email);
  if (!normalizedEmail) return '';
  const employee = employeesCache.find((entry) => {
    const normalized = normalizeEmployeeRecord(entry);
    return normalized.email === normalizedEmail || normalizeIdentityKey(normalized.id) === normalizedEmail;
  });
  return employee?.homePool || '';
}

function ensureHomeActionLoadingOverlay() {
  let overlay = document.getElementById('homeActionLoadingOverlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'homeActionLoadingOverlay';
  overlay.className = 'home-action-loading-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = '<div class="home-action-loading-spinner" role="status" aria-label="Loading"></div>';
  document.body.appendChild(overlay);
  return overlay;
}

function setHomeMenuButtonsBusy(isBusy) {
  document.querySelectorAll('.home-menu-item').forEach((button) => {
    button.disabled = !!isBusy;
    button.setAttribute('aria-busy', isBusy ? 'true' : 'false');
  });
}

function showHomeActionLoadingOverlay() {
  homeMenuActionPending = true;
  const overlay = ensureHomeActionLoadingOverlay();
  setHomeMenuButtonsBusy(true);
  overlay.style.display = 'flex';
  overlay.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => overlay.classList.add('visible'));
}

function hideHomeActionLoadingOverlay() {
  const overlay = document.getElementById('homeActionLoadingOverlay');
  homeMenuActionPending = false;
  setHomeMenuButtonsBusy(false);
  if (!overlay) return;
  overlay.classList.remove('visible');
  overlay.setAttribute('aria-hidden', 'true');
  setTimeout(() => {
    if (!overlay.classList.contains('visible')) overlay.style.display = 'none';
  }, 180);
}

function setRole(role) {
  currentRole = normalizeAccessMode(role);

  const options = roleToggle?.querySelectorAll('.theme-toggle-option') || [];
  options.forEach((opt) => {
    opt.classList.toggle('active', opt.dataset.role === currentRole);
  });

  const thumb = document.getElementById('roleToggleThumb');
  if (thumb) {
    thumb.style.transform = currentRole === 'lifeguard' ? 'translateX(0%)' : 'translateX(100%)';
  }

  if (currentRole === 'supervisor') {
    usernameLabel.textContent = 'Email';
    usernameInput.type = 'email';
    usernameInput.autocomplete = 'email';
    passwordLabel.textContent = 'Password';
    passwordInput.type = 'password';
    passwordInput.autocomplete = 'current-password';
    showCreateAccountBtn?.classList.add('hidden');
    if (currentView !== 'login') setModalView('login');
  } else if (currentRole === 'manager') {
    usernameLabel.textContent = 'Username or Email';
    usernameInput.type = 'text';
    usernameInput.autocomplete = 'username';
    passwordLabel.textContent = 'Password';
    passwordInput.type = 'password';
    passwordInput.autocomplete = 'current-password';
    showCreateAccountBtn?.classList.add('hidden');
    if (currentView !== 'login') setModalView('login');
  } else {
    usernameLabel.textContent = 'Username or Email';
    usernameInput.type = 'text';
    usernameInput.autocomplete = 'username';
    passwordLabel.textContent = 'Password';
    passwordInput.type = 'password';
    passwordInput.autocomplete = 'current-password';
    showCreateAccountBtn?.classList.remove('hidden');
  }

  updateFirstTimeCallout();
  clearMessages();
}

function updateFirstTimeCallout() {
  if (!firstTimeCallout) return;
  const show = currentView === 'login' && (currentRole === 'lifeguard' || currentRole === 'attendant');
  firstTimeCallout.classList.toggle('hidden', !show);
  firstTimeCallout.setAttribute('aria-hidden', show ? 'false' : 'true');
}

function openModal(target) {
  hideHomeActionLoadingOverlay();
  const role = normalizeAccessMode(target);
  pendingTarget = 'chem';
  setRole(role);
  if (roleToggle) roleToggle.style.display = 'none';
  modalOpenedAt = Date.now();
  modal.style.display = 'flex';
  requestAnimationFrame(() => modal.classList.add('visible'));
  resetForms();
  setModalView('login');
}

function closeModal() {
  hideHomeActionLoadingOverlay();
  modal.classList.remove('visible');
  setTimeout(() => {
    modal.style.display = 'none';
  }, 200);
  pendingTarget = null;
  profileCompletionContext = null;
  restoreCreateAccountMode();
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
    populatePoolOptions();
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
    cacheHomePoolOptions(homePoolOptions);
    populatePoolOptions();
  } catch (err) {
    console.error('Failed to load pools:', err);
    populatePoolOptions();
  }
}

function waitForHomeDataTimeout(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
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

function getSignupRoleForCurrentAccessMode() {
  const accessMode = normalizeAccessMode(currentRole);
  if (accessMode === 'attendant') return 'attendant';
  if (accessMode === 'manager') return 'poolManager';
  return 'lifeguard';
}

function buildSignupRecords({ username, firstName, lastName, email, phone, homePool, role = 'lifeguard' }) {
  const validRoleKeys = new Set(ROLE_DEFINITIONS.map(({ key }) => key));
  const normalizedRole = validRoleKeys.has(role) ? role : 'lifeguard';
  const createdAt = new Date().toISOString();
  const employeeRecord = {
    email,
    id: email,
    username,
    firstName,
    lastName,
    phone,
    homePool,
    role: normalizedRole,
    roles: [normalizedRole],
    createdAt,
  };

  const accountData = {
    username,
    authEmail: email,
    employeeEmail: email,
    firstName,
    lastName,
    phone,
    homePool,
    role: normalizedRole,
    roles: [normalizedRole],
    phoneLinked: false,
    createdAt,
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

async function assignSignupRolePermissions(employeeRecord, role = 'lifeguard') {
  const memberKey = normalizeIdentityKey(employeeRecord?.email || employeeRecord?.id || employeeRecord?.username);
  if (!memberKey) return;
  const validRoleKeys = new Set(ROLE_DEFINITIONS.map(({ key }) => key));
  const roleKey = validRoleKeys.has(role) ? role : 'lifeguard';
  try {
    const ref = doc(db, 'settings', ROLE_PERMISSIONS_DOC_ID);
    const snap = await getDoc(ref);
    const next = normalizeRolesPermissionsData(snap.exists() ? snap.data() : {});
    if (!next.roles[roleKey].includes(memberKey)) next.roles[roleKey].push(memberKey);
    await setDoc(ref, next, { merge: false });
    homeRolesPermissionsData = next;
  } catch (err) {
    console.warn('Could not assign signup role permissions:', err);
  }
}

async function saveSignupRecords(accountRef, accountData, employeeRecord) {
  await Promise.all([
    setDoc(accountRef, accountData, { merge: true }),
    upsertEmployeeRecord(employeeRecord),
  ]);
  await assignSignupRolePermissions(employeeRecord, accountData?.role);
}

async function ensureEmployeeProfileForAccess({ username, account, target, accessMode }) {
  if (!employeesCache.length) await loadEmployees();
  const existingEmployee = findEmployeeForAccount(account, username);
  const mergedEmployee = mergeEmployeeProfiles(
    buildEmployeeFromAccount(account),
    existingEmployee,
    { username }
  );
  const missing = getMissingEmployeeProfileFields(mergedEmployee);

  if (missing.length) {
    openProfileCompletionView({ username, account, employee: mergedEmployee, target, accessMode });
    setMessage(
      createMessageEl,
      `Complete your ${missing.join(', ')} before opening PoolPro.`,
      true
    );
    return null;
  }

  await upsertEmployeeRecord(mergedEmployee);
  return mergedEmployee;
}

function showSignupVerification(username, accountData, message, accessMode = 'lifeguard') {
  const normalizedAccessMode = normalizeAccessMode(accessMode);
  persistAccessMode(normalizedAccessMode);
  setRole(normalizedAccessMode);
  openVerificationView({
    username,
    account: accountData,
    target: getDestinationPath(),
    force: true,
    origin: 'create',
    accessMode: normalizedAccessMode,
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
    'Setup resumed. Check your email, verify it, then sign in.',
    accountData?.role || 'lifeguard'
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

  if (!refreshedUser?.emailVerified && !hasEmailVerificationOverride(account)) {
    clearLifeguardSession();
    throw new Error('Verify your email before opening PoolPro.');
  }
}

async function finalizeLifeguardAccess({ username, account, target, method, accessMode = 'lifeguard' }) {
  await requireVerifiedCurrentUserForAccount(account);
  const normalizedAccessMode = normalizeAccessMode(accessMode);
  await assertAccessModeAllowed(normalizedAccessMode, getIdentityKeysForAccount(account, username));
  const employeeForAccess = await ensureEmployeeProfileForAccess({
    username,
    account,
    target,
    accessMode: normalizedAccessMode,
  });
  if (!employeeForAccess) return { requiresProfileCompletion: true };
  stopVerifyStatusPoller();
  clearPendingVerificationContext();

  try {
    const overrideUsed = hasEmailVerificationOverride(account) && !auth.currentUser?.emailVerified;
    await setDoc(doc(db, 'lifeguardAccounts', username), {
      lastVerifiedAt: overrideUsed ? (account.lastVerifiedAt || new Date().toISOString()) : new Date().toISOString(),
      lastVerificationMethod: overrideUsed ? 'supervisor-email-override' : (method || ''),
      phoneLinked: !!account.phoneLinked,
    }, { merge: true });
  } catch (err) {
    console.warn('Could not update verification metadata:', err);
  }

  markDeviceVerified(account.employeeEmail || account.authEmail || '');
  persistLifeguardSession(employeeForAccess, username, normalizedAccessMode);
  resetVerificationState();
  closeModal();

  const accepted = await requireUserAgreement(buildLifeguardAgreementContext(account, username, normalizedAccessMode), {
    onDecline: async () => {
      clearLifeguardSession();
    },
  });
  if (!accepted) return;

  await maybeShowLifeguardCleanlinessReminder(normalizedAccessMode, employeeForAccess?.homePool || account?.homePool);
  window.location.href = target || getDestinationPath();
  return { requiresProfileCompletion: false };
}

async function requirePasswordLoginAfterVerification(message) {
  const targetPath = pendingVerification?.target || getDestinationPath();
  const targetKey = targetKeyFromDestinationPath(targetPath);
  const accessMode = normalizeAccessMode(pendingVerification?.accessMode || currentRole);

  stopVerifyStatusPoller();
  clearPendingVerificationContext();
  resetVerificationState();
  await signOut(auth).catch(() => {});
  clearLifeguardSession();

  if (modal && modal.style.display !== 'flex') {
    openModal(accessMode);
  } else {
    pendingTarget = targetKey;
    setRole(accessMode);
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
  accessMode = currentRole,
}) {
  const normalizedUsername = normalizeUsername(username);
  const targetPath = sanitizeTarget(target || getDestinationPath());
  const normalizedAccessMode = normalizeAccessMode(accessMode);
  const email = (account.employeeEmail || getAuthEmail(account) || '').trim().toLowerCase();
  const priorContext = loadPendingVerificationContext();
  const priorEmail = (priorContext?.email || '').trim().toLowerCase();
  const priorSentAt =
    priorContext?.username === normalizedUsername &&
    priorEmail &&
    priorEmail === email &&
    priorContext?.emailAuthMode === emailAuthMode &&
    normalizeAccessMode(priorContext?.accessMode) === normalizedAccessMode
      ? Number(priorContext.sentAt || 0)
      : 0;

  pendingVerification = {
    username: normalizedUsername,
    account,
    target: targetPath,
    origin,
    force,
    emailAuthMode,
    accessMode: normalizedAccessMode,
  };

  savePendingVerificationContext({
    username: pendingVerification.username,
    email,
    target: pendingVerification.target,
    sentAt: force ? 0 : priorSentAt,
    emailAuthMode,
    accessMode: normalizedAccessMode,
  });

  if (verifySubtitleEl) {
    verifySubtitleEl.textContent = `Open the email sent to ${maskEmail(email)}, verify it, then sign in again.`;
  }
  if (verifyHintEl) {
    verifyHintEl.textContent = 'Check spam after 60 seconds. Resend if needed.';
  }
  if (verifyResendBtn) verifyResendBtn.textContent = 'Resend Verification';
  setMessage(
    verifyMessageEl,
    'Sending verification email...'
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
    normalizeAccessMode(existingContext?.accessMode) === normalizedAccessMode &&
    !force &&
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

  if (verifyResendBtn) verifyResendBtn.disabled = true;
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
    verifyCooldownUntil = 0;
    updateVerifyCooldownUi();
  });
}

function markSupervisorLoggedIn(email, accessMode = 'supervisor') {
  const normalizedAccessMode = persistAccessMode(accessMode);
  try {
    localStorage.setItem('trainingSupervisorLoggedIn', 'true');
    localStorage.setItem('training_supervisor_logged_in_v1', 'true');
    localStorage.setItem('ChemLogSupervisor', 'true');
    const expires = Date.now() + VERIFY_WINDOW_MS;
    localStorage.setItem('loginToken', JSON.stringify({
      username: email || 'supervisor',
      expires,
      emailVerified: true,
      verificationVersion: SUPERVISOR_SESSION_VERIFICATION_VERSION,
      verifiedAt: new Date().toISOString(),
    }));
    localStorage.setItem(ROLE_STORAGE_KEY, 'supervisor');
    localStorage.setItem(ACCESS_MODE_STORAGE_KEY, normalizedAccessMode);
    sessionStorage.setItem(ACCESS_MODE_STORAGE_KEY, normalizedAccessMode);
    localStorage.removeItem(LIFEGUARD_SESSION_KEY);
    markDeviceVerified(email);
  } catch (err) {
    console.warn('Could not persist supervisor login flags', err);
  }
}

async function authenticateSupervisor(email, password, accessMode = 'supervisor') {
  const e = (email || '').trim();
  const p = password || '';
  if (!e || !p) throw new Error('Please enter your email and password.');
  await assertLoginAttemptsRemaining('supervisor', e);

  try {
    await signInWithEmailAndPassword(auth, e, p);
    await auth.currentUser?.reload();
    if (!auth.currentUser?.emailVerified) {
      const verifyUrl = new URL(window.location.href);
      verifyUrl.search = '';
      verifyUrl.hash = '';
      verifyUrl.searchParams.set('accessMode', normalizeAccessMode(accessMode));
      verifyUrl.searchParams.set('target', getDestinationPath());
      await sendEmailVerification(auth.currentUser, {
        url: verifyUrl.toString(),
        handleCodeInApp: false,
      }).catch((verifyErr) => {
        console.warn('Could not send supervisor verification email:', verifyErr);
      });
      await signOut(auth).catch(() => {});
      clearSupervisorSession();
      throw new Error('Verify your email before opening PoolPro. A verification email has been sent if Firebase allowed it.');
    }
    await assertAccessModeAllowed(accessMode, getIdentityKeysForSupervisor(e));
    markSupervisorLoggedIn(e, accessMode);
    await clearLoginFailures('supervisor', e);
  } catch (err) {
    const code = err.code || '';
    if (code === 'agreement/required') {
      await clearLoginFailures('supervisor', e);
      throw err;
    }
    if ((err.message || '').includes('access')) {
      await signOut(auth).catch(() => {});
      clearSupervisorSession();
      throw err;
    }
    if (
      code === 'auth/wrong-password' ||
      code === 'auth/user-not-found' ||
      code === 'auth/invalid-credential' ||
      code === 'auth/too-many-requests'
    ) {
      const state = await recordLoginFailure('supervisor', e, {
        lockImmediately: code === 'auth/too-many-requests',
      });
      if (state.blockedUntil && state.blockedUntil > Date.now()) {
        throw createLoginLockoutError(state.blockedUntil - Date.now());
      }
      throw new Error('Email not found or password incorrect.');
    }
    throw err;
  }
}

async function authenticateLifeguard(usernameRaw, passwordRaw, accessMode = 'lifeguard') {
  const rawLogin = String(usernameRaw || '').trim();
  const looksLikeEmail = rawLogin.includes('@');
  let username = normalizeUsername(rawLogin);
  const password = passwordRaw || '';
  if (!rawLogin || !password) throw new Error('Please enter your username and password.');
  await assertLoginAttemptsRemaining('lifeguard', username);

  let account;
  try {
    if (looksLikeEmail) {
      account = await findLifeguardAccountByEmail(rawLogin);
      if (!account) throw new Error('Username not found. Create an account first, then ask your supervisor for help if the issue persists.');
      username = normalizeUsername(account.username || username);
    } else {
      account = await getLifeguardAccount(username);
    }
  } catch (err) {
    if ((err?.message || '').toLowerCase().includes('username not found')) {
      if (looksLikeEmail) throw err;
      const state = await recordLoginFailure('lifeguard', username);
      if (state.blockedUntil && state.blockedUntil > Date.now()) {
        throw createLoginLockoutError(state.blockedUntil - Date.now());
      }
    }
    throw err;
  }
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
      const state = await recordLoginFailure('lifeguard', username, {
        lockImmediately: code === 'auth/too-many-requests',
      });
      if (state.blockedUntil && state.blockedUntil > Date.now()) {
        throw createLoginLockoutError(state.blockedUntil - Date.now());
      }
      throw new Error('Incorrect password. Try again or reset it.');
    }
    throw err;
  }
  await clearLoginFailures('lifeguard', username);
  const user = auth.currentUser;

  if (!user?.emailVerified && !hasEmailVerificationOverride(account)) {
    openVerificationView({
      username,
      account,
      target: getDestinationPath(),
      origin: 'login',
      emailAuthMode: EMAIL_AUTH_MODE_VERIFY,
      accessMode,
    });
    return { requiresVerification: true };
  }

  const finalizeResult = await finalizeLifeguardAccess({
    username,
    account,
    target: getDestinationPath(),
    method: 'password-login',
    accessMode,
  });
  return { requiresVerification: false, requiresProfileCompletion: !!finalizeResult?.requiresProfileCompletion };
}

async function authenticateForCurrentRole(identifier, password) {
  const accessMode = normalizeAccessMode(currentRole);
  const login = String(identifier || '').trim();

  if (accessMode === 'supervisor') {
    await authenticateSupervisor(login, password, 'supervisor');
    return { requiresVerification: false, authType: 'supervisor', accessMode };
  }

  if (login.includes('@')) {
    try {
      const result = await authenticateLifeguard(login, password, accessMode);
      return { ...result, authType: 'lifeguard', accessMode };
    } catch (err) {
      const message = (err?.message || '').toLowerCase();
      if (!message.includes('username not found')) throw err;
      await authenticateSupervisor(login, password, accessMode);
      return { requiresVerification: false, authType: 'supervisor', accessMode };
    }
  }

  const result = await authenticateLifeguard(login, password, accessMode);
  return { ...result, authType: 'lifeguard', accessMode };
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
      accessMode: pendingVerification.accessMode,
    }),
    handleCodeInApp: false,
  });

  savePendingVerificationContext({
    username: pendingVerification.username,
    email,
    target: pendingVerification.target,
    sentAt: Date.now(),
    emailAuthMode: EMAIL_AUTH_MODE_VERIFY,
    accessMode: pendingVerification.accessMode,
  });

  startVerifyCooldown();
  setMessage(
    verifyMessageEl,
    `${isResend ? 'Verification email resent' : 'Verification email sent'} to ${maskEmail(email)}. Verify it, then sign in again.`
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
    const accessMode = normalizeAccessMode(url.searchParams.get('accessMode') || loadPendingVerificationContext()?.accessMode || 'lifeguard');

    window.history.replaceState({}, document.title, window.location.pathname);
    clearPendingVerificationContext();
    resetVerificationState();
    await signOut(auth).catch(() => {});
    openModal(accessMode || targetKeyFromDestinationPath(target));
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
  if (loginSubmitting) return;
  setLoginSubmitting(true);
  setMessage(messageEl, 'Signing in...');

  try {
    const result = await authenticateForCurrentRole(usernameInput.value, passwordInput.value);
    if (result?.requiresVerification) return;
    if (result?.authType !== 'supervisor') return;

    closeModal();
    const accepted = await requireUserAgreement(buildSupervisorAgreementContext(usernameInput.value, result.accessMode), {
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
      ? (currentRole !== 'supervisor'
        ? 'Username not found. Create an account first, then ask your supervisor for help if the issue persists.'
        : 'Email not found or password incorrect.')
      : code === 'agreement/required'
        ? 'You must accept the user agreement before using PoolPro.'
      : (err.message || 'Login failed. Please try again.');
    setMessage(messageEl, friendly, true);
  } finally {
    setLoginSubmitting(false);
  }
}

async function handleProfileCompletionSubmit() {
  if (!profileCompletionContext) return false;

  const username = profileCompletionContext.username;
  const account = profileCompletionContext.account || {};
  const firstName = createFirstNameInput?.value.trim() || '';
  const lastName = createLastNameInput?.value.trim() || '';
  const email = (createEmailInput?.value.trim() || getAuthEmail(account) || '').toLowerCase();
  const phone = normalizePhoneDigits(createPhoneInput?.value);
  const homePool = createPoolInput?.value || '';
  const role = account?.role || getSignupRoleForCurrentAccessMode();

  if (!username || !firstName || !lastName || !email || !phone || !homePool) {
    setMessage(createMessageEl, 'Please complete every field in the account form.', true);
    return true;
  }
  if (!email.includes('@')) {
    setMessage(createMessageEl, 'Please enter a valid email address.', true);
    return true;
  }

  const { employeeRecord, accountData } = buildSignupRecords({
    username,
    firstName,
    lastName,
    email,
    phone,
    homePool,
    role,
  });
  const preservedRole = account?.role || accountData.role;
  const preservedCreatedAt = account?.createdAt || accountData.createdAt;
  const preservedEmailOverride = account?.emailVerificationOverride === true ? {
    emailVerificationOverride: true,
    emailVerificationOverrideAt: account.emailVerificationOverrideAt || '',
    emailVerificationOverrideBy: account.emailVerificationOverrideBy || '',
  } : {};
  const updatedAccount = {
    ...account,
    ...accountData,
    role: preservedRole,
    createdAt: preservedCreatedAt,
    ...preservedEmailOverride,
    profileCompletedAt: new Date().toISOString(),
  };
  const completedEmployeeRecord = {
    ...employeeRecord,
    role: preservedRole,
    createdAt: preservedCreatedAt,
  };

  await Promise.all([
    setDoc(doc(db, 'lifeguardAccounts', username), updatedAccount, { merge: true }),
    upsertEmployeeRecord(completedEmployeeRecord),
  ]);
  profileCompletionContext.account = updatedAccount;
  const resumeContext = { ...profileCompletionContext, account: updatedAccount };
  profileCompletionContext = null;
  restoreCreateAccountMode();

  await finalizeLifeguardAccess({
    username,
    account: updatedAccount,
    target: resumeContext.target,
    method: 'profile-completion',
    accessMode: resumeContext.accessMode,
  });
  return true;
}

async function handleCreateAccountSubmit(event) {
  event.preventDefault();
  if (createAccountSubmitting) return;
  setCreateAccountSubmitting(true);
  setMessage(createMessageEl, '');

  try {
    if (await handleProfileCompletionSubmit()) return;

    const username = normalizeUsername(createUsernameInput?.value);
    const firstName = createFirstNameInput?.value.trim() || '';
    const lastName = createLastNameInput?.value.trim() || '';
    const email = (createEmailInput?.value.trim() || '').toLowerCase();
    const phone = normalizePhoneDigits(createPhoneInput?.value);
    const homePool = createPoolInput?.value || '';
    const password = createPasswordInput?.value || '';
    const confirmPassword = createConfirmPasswordInput?.value || '';
    const signupRole = getSignupRoleForCurrentAccessMode();

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
      role: signupRole,
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
      'Check your email, verify it, then sign in.',
      signupRole
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
        const signupRole = getSignupRoleForCurrentAccessMode();
        const { employeeRecord, accountData } = buildSignupRecords({
          username,
          firstName,
          lastName,
          email,
          phone,
          homePool,
          role: signupRole,
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
    setMessage(resetMessageEl, currentRole === 'supervisor' ? 'Please enter your email.' : 'Please enter your username or email.', true);
    return;
  }

  try {
    let resetEmail = value;
    if (currentRole !== 'supervisor') {
      const account = value.includes('@')
        ? await findLifeguardAccountByEmail(value)
        : await getLifeguardAccount(normalizeUsername(value));
      if (!account) throw new Error('Username not found.');
      resetEmail = account.authEmail || account.employeeEmail || '';
      if (!resetEmail) throw new Error('No email address found for this username. Contact your supervisor.');
    }
    await sendPasswordResetEmail(auth, resetEmail);
    setMessage(resetMessageEl, 'Password reset email sent. Check your inbox.', false);
    if (resetFieldInput) resetFieldInput.value = '';
  } catch (err) {
    const code = err.code || '';
    const friendly = code === 'auth/user-not-found' || code === 'auth/invalid-email'
      ? (currentRole === 'supervisor' ? 'No account found for that email.' : 'Username not found.')
      : (err.message || 'Could not send reset email. Please try again.');
    setMessage(resetMessageEl, friendly, true);
  }
}

async function activateHomeMenuButton(btn, event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if (homeMenuActionPending) return;
  const now = Date.now();
  if (now - lastHomeMenuActivationAt < 500) return;
  lastHomeMenuActivationAt = now;
  showHomeActionLoadingOverlay();

  try {
    const requestedMode = normalizeAccessMode(btn.dataset.accessRole || btn.dataset.target);
    pendingTarget = requestedMode === 'supervisor' ? 'supervisor' : 'chem';

    if (hasFreshSupervisorSession()) {
      try {
        await assertAccessModeAllowed(requestedMode, getIdentityKeysForSupervisor(getStoredSupervisorEmail()));
        persistAccessMode(requestedMode);
        window.location.href = getDestinationPath();
      } catch (err) {
        openModal(requestedMode);
        setMessage(messageEl, err.message || 'This account does not have access to that version of PoolPro.', true);
      }
      return;
    }

    const storedLifeguardSession = getStoredLifeguardSession();
    if (storedLifeguardSession && requestedMode !== 'supervisor') {
      try {
        await assertAccessModeAllowed(requestedMode, [
          storedLifeguardSession.email,
          storedLifeguardSession.employeeId,
          storedLifeguardSession.username,
        ]);
        persistAccessMode(requestedMode);
        window.location.href = getDestinationPath();
      } catch (err) {
        openModal(requestedMode);
        setMessage(messageEl, err.message || 'This account does not have access to that version of PoolPro.', true);
      }
      return;
    }

    openModal(requestedMode);
  } catch (err) {
    console.error('Home menu activation failed:', err);
    hideHomeActionLoadingOverlay();
  }
}

function handleHomeMenuPointerActivation(btn, event) {
  if (event.type === 'pointerdown' && event.pointerType === 'mouse' && event.button !== 0) return;
  const now = Date.now();
  if (now - homeMenuPointerActivationAt < 700) return;
  homeMenuPointerActivationAt = now;
  activateHomeMenuButton(btn, event);
}

function handleHomeMenuClickActivation(btn, event) {
  if (Date.now() - homeMenuPointerActivationAt < 700) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  activateHomeMenuButton(btn, event);
}

function wireMenu() {
  document.querySelectorAll('.home-menu-item').forEach((btn) => {
    if (btn.dataset.homeMenuBound === 'true') return;
    btn.dataset.homeMenuBound = 'true';
    btn.type = 'button';
    btn.addEventListener('pointerdown', (event) => handleHomeMenuPointerActivation(btn, event));
    btn.addEventListener('touchend', (event) => handleHomeMenuPointerActivation(btn, event));
    btn.addEventListener('click', (event) => handleHomeMenuClickActivation(btn, event));
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

function requestLoginSubmitFromButton() {
  if (!form || loginSubmitting) return;
  if (typeof form.requestSubmit === 'function') {
    form.requestSubmit(loginSubmitBtn || undefined);
    return;
  }
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function handleLoginSubmitTouch(event) {
  if (event.type === 'pointerdown' && event.pointerType && !['touch', 'pen'].includes(event.pointerType)) return;

  const now = Date.now();
  event.preventDefault();
  event.stopPropagation();

  if (now - loginSubmitTouchAt < 700) return;
  loginSubmitTouchAt = now;
  requestAnimationFrame(requestLoginSubmitFromButton);
}

function handleLoginSubmitClick(event) {
  if (Date.now() - loginSubmitTouchAt >= 700) return;
  event.preventDefault();
  event.stopPropagation();
}

function wireLoginSubmitTouchFallback() {
  if (!loginSubmitBtn) return;
  loginSubmitBtn.addEventListener('pointerdown', handleLoginSubmitTouch);
  loginSubmitBtn.addEventListener('touchend', handleLoginSubmitTouch);
  loginSubmitBtn.addEventListener('click', handleLoginSubmitClick);
}

function handleForgotPasswordClick(event) {
  event.preventDefault();
  event.stopPropagation();
  if (!modal || modal.style.display !== 'flex' || currentView !== 'login') return;
  if (Date.now() - modalOpenedAt < 700) return;
  setModalView('reset');
}

function wireHomeModalControls() {
  if (homeModalControlsBound) return;
  homeModalControlsBound = true;

  form?.addEventListener('submit', handleSubmit);
  wireLoginSubmitTouchFallback();
  document.querySelectorAll('[data-password-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.passwordToggle);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.classList.toggle('is-visible', show);
      button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      button.setAttribute('aria-pressed', show ? 'true' : 'false');
      input.focus({ preventScroll: true });
    });
  });
  createAccountForm?.addEventListener('submit', handleCreateAccountSubmit);
  closeBtn?.addEventListener('click', async () => {
    if (auth.currentUser && currentRole !== 'supervisor') {
      await signOut(auth).catch(() => {});
    }
    closeModal();
  });
  showCreateAccountBtn?.addEventListener('click', () => setModalView('create'));
  forgotPasswordBtn?.addEventListener('click', handleForgotPasswordClick);
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
    if (auth.currentUser && currentRole !== 'supervisor') {
      await signOut(auth).catch(() => {});
    }
    closeModal();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  mountUnifiedFooter();
  wireMenu();
  wireRoleToggle();
  wireHomeModalControls();
  setupMobileModalFocusGuards();
  const handledVerificationRedirect = await handleEmailVerificationRedirect();
  populatePoolOptions({ loading: true });
  const homeDataLoad = Promise.allSettled([loadEmployees(), loadPools()]);
  await Promise.race([homeDataLoad, waitForHomeDataTimeout(HOME_POOL_LOAD_WAIT_MS)]);
  populatePoolOptions();

  const pendingContext = loadPendingVerificationContext();
  if (pendingContext?.username && auth.currentUser) {
    const pendingMode = pendingContext.emailAuthMode || EMAIL_AUTH_MODE_VERIFY;
    const pendingAccessMode = normalizeAccessMode(pendingContext.accessMode || 'lifeguard');
    const account = await getLifeguardAccount(pendingContext.username);
    if (auth.currentUser.emailVerified) {
      pendingVerification = {
        username: pendingContext.username,
        account,
        target: pendingContext.target || getDestinationPath(),
        origin: handledVerificationRedirect ? 'redirect-resume' : 'resume',
        force: true,
        emailAuthMode: pendingMode,
        accessMode: pendingAccessMode,
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
      accessMode: pendingAccessMode,
    });
  }

  if (handledVerificationRedirect) return;

  let initialRole = 'lifeguard';
  try {
    const stored = localStorage.getItem(ACCESS_MODE_STORAGE_KEY);
    if (ACCESS_MODES.has(stored)) initialRole = stored;
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
