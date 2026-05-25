// script.js — Main ChemLog application logic
// Loaded as type="module" from chem/chem.html and training/training.html

import {
  db,
  auth,
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  serverTimestamp,
  writeBatch,
  deleteDoc,
  listenPools,
  signInWithEmailAndPassword,
  signOut,
  deleteUser,
  onAuthStateChanged,
  EmailAuthProvider,
  reauthenticateWithCredential
} from './firebase.js';
import { requireUserAgreement } from './agreement.js';
import { getApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js';

// ============================================================
// PAGE-LOADED FADE-IN
// ============================================================

let formSubmissions = [];           // ✅ fixes ReferenceError at line 792
let filteredSubmissions = [];
let allSubmissions = [];
let filteredData = [];
let paginatedData = [];
let currentPage = 1;
const itemsPerPage = 20;
let isLoggedIn = false;
let sanitationSettings = {};        // ✅ fixes ReferenceError at line 695
let currentView = 'form';
let dashboardRows = [];
let trainingSchedule = {
  sessions: []
};
let securitySettings = {
  sessionTimeout: '360',
  requirePasswordConfirm: true,
};
let securityIdleTimer = null;
let securityEventsBound = false;
let agreementGatePromise = null;
let accountDeletionInProgress = false;
let sanitationEditing = false;
let sanitationMarketFilter = 'all';
const FEEDBACK_RESPONSES_ENABLED = false;
const SESSION_WINDOW_MS = 5 * 60 * 60 * 1000;
const LIFEGUARD_SESSION_KEY = 'poolproLifeguardSession';
const LIFEGUARD_SESSION_VERIFICATION_VERSION = 1;
window.trainingSchedule = trainingSchedule;
window.addEventListener('load', () => {
  document.body.classList.add('page-loaded');
});

// PoolPro now uses dark styling by default across the app.
localStorage.setItem('chemlogDarkMode', 'true');
document.body.classList.add('dark-mode');

// ============================================================
// MENU / DROPDOWN
// ============================================================

window.toggleMenu = function (btn) {
  const container = btn.closest('.menu-container');
  if (!container) return;
  const menu = container.querySelector('.dropdown-menu');
  if (!menu) return;
  const isOpen = menu.classList.contains('show');
  // Close all open menus first
  document.querySelectorAll('.dropdown-menu.show').forEach(m => m.classList.remove('show'));
  if (!isOpen) menu.classList.add('show');
};

// Close dropdown when clicking outside any menu container
document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu-container')) {
    document.querySelectorAll('.dropdown-menu.show').forEach(m => m.classList.remove('show'));
  }
});

// Open inline/chunked resources as blob URLs (direct data: links are blocked in modern browsers)
document.addEventListener('click', async (e) => {
  const link = e.target.closest('.resource-doc-link');
  if (!link) return;
  e.preventDefault();
  const key = link.dataset.resourceKey;
  const resource = resourcesData.find((item) => item.id === key);
  const resourceUrl = resource?.fileUrl || resourceDataUrlMap.get(key) || '';
  if (!resourceUrl) return;
  try {
    const dataUrl = resource?.storageType === FIRESTORE_RESOURCE_STORAGE
      || resourceUrl.startsWith(`${FIRESTORE_RESOURCE_STORAGE}:`)
      ? await getFirestoreResourceDataUrl(key)
      : resourceUrl;
    openResourceDataUrl(dataUrl);
  } catch (err) {
    console.error('[PoolPro] Could not open resource file:', err);
    alert('Unable to open this resource right now.');
  }
});

document.addEventListener('click', (e) => {
  const trigger = e.target.closest('.dash-value-trigger');
  document.querySelectorAll('.dash-value-cell.open').forEach((cell) => {
    if (!trigger || !cell.contains(trigger)) cell.classList.remove('open');
  });
  if (!trigger) return;
  e.preventDefault();
  trigger.closest('.dash-value-cell')?.classList.toggle('open');
});

function getPagePrefix() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  parts.pop();
  const subDirs = ['chem', 'Chem', 'training', 'Training', 'editor', 'Editor', 'main', 'Main', 'duties', 'Duties', 'managerial', 'Managerial', 'employees', 'Employees', 'testing', 'Testing', 'resources', 'Resources', 'operational', 'Operational'];
  const last = parts[parts.length - 1] || '';
  return subDirs.includes(last) ? '../' : '';
}

function injectOperationalStatusMenuLinks() {
  const prefix = getPagePrefix();
  const isOperationalPage = /\/operational\/operational\.html$/i.test(window.location.pathname);

  document.querySelectorAll('.dropdown-menu').forEach((menu) => {
    if (menu.querySelector('[data-nav="operational-status"]')) return;
    const anchorLink = menu.querySelector('[data-nav="managerial-report"]') || menu.querySelector('[data-nav="duties"]');
    if (!anchorLink) return;

    const link = document.createElement('a');
    link.href = isOperationalPage ? 'operational.html' : `${prefix}operational/operational.html`;
    link.className = `dropdown-item${isOperationalPage ? ' active-page' : ''}`;
    link.dataset.nav = 'operational-status';
    link.textContent = 'Operational Status Log';
    anchorLink.insertAdjacentElement('afterend', link);
  });
}

function injectManagerialReportMenuLinks() {
  const prefix = getPagePrefix();
  const isManagerialPage = /\/managerial\/managerial\.html$/i.test(window.location.pathname);

  document.querySelectorAll('.dropdown-menu').forEach((menu) => {
    if (menu.querySelector('[data-nav="managerial-report"]')) return;
    const dutiesLink = menu.querySelector('[data-nav="duties"]');
    if (!dutiesLink) return;

    const link = document.createElement('a');
    link.href = isManagerialPage ? 'managerial.html' : `${prefix}managerial/managerial.html`;
    link.className = `dropdown-item${isManagerialPage ? ' active-page' : ''}`;
    link.dataset.nav = 'managerial-report';
    link.textContent = 'Managerial Report';
    dutiesLink.insertAdjacentElement('afterend', link);
  });
}

function injectResourcesMenuLinks() {
  const prefix = getPagePrefix();
  const isResourcesPage = /\/resources\/resources\.html$/i.test(window.location.pathname);

  document.querySelectorAll('.dropdown-menu').forEach((menu) => {
    if (menu.querySelector('[data-nav="resources"]')) return;
    const anchorLink = menu.querySelector('[data-nav="operational-status"]') || menu.querySelector('[data-nav="duties"]');
    if (!anchorLink) return;

    const link = document.createElement('a');
    link.href = isResourcesPage ? 'resources.html' : `${prefix}resources/resources.html`;
    link.className = `dropdown-item${isResourcesPage ? ' active-page' : ''}`;
    link.dataset.nav = 'resources';
    link.textContent = 'Resources';
    anchorLink.insertAdjacentElement('afterend', link);
  });
}

function injectLifeguardSettingsMenuLinks() {
  document.querySelectorAll('.dropdown-menu').forEach((menu) => {
    if (menu.querySelector('[data-nav="lifeguard-settings"]')) return;

    const link = document.createElement('a');
    link.href = '#';
    link.className = 'dropdown-item lifeguard-only';
    link.dataset.nav = 'lifeguard-settings';
    link.textContent = 'Settings';
    link.addEventListener('click', (event) => {
      event.preventDefault();
      window.openSettings();
    });

    const logoutLink = menu.querySelector('[data-nav="logout"]');
    const supervisorStart = menu.querySelector('.supervisor-only');
    const anchor = logoutLink || supervisorStart;
    if (anchor) anchor.insertAdjacentElement('beforebegin', link);
    else menu.appendChild(link);
  });
}

function normalizeSharedHeaderCopy() {
  document.querySelectorAll('.header-title-block p, .header-left > div:first-child > p').forEach((subtitle) => {
    if (!subtitle || subtitle.dataset.headerCopyReady === 'true') return;
    subtitle.textContent = '';
    subtitle.dataset.headerCopyReady = 'true';
  });
}

function createFloatingHeader(sourceHeader) {
  if (!sourceHeader || sourceHeader.dataset.floatingReady === 'true') return;
  const menuContainer = sourceHeader.querySelector('.menu-container');
  const logo = sourceHeader.querySelector('#logo, img[alt*="logo" i]');
  if (!menuContainer || !logo) return;

  const floating = document.createElement(sourceHeader.tagName.toLowerCase());
  floating.className = `${sourceHeader.className} floating-header`;

  const content = document.createElement('div');
  content.className = 'header-content';
  const left = document.createElement('div');
  left.className = sourceHeader.matches('.app-header')
    ? 'training-header-left header-left--compact'
    : 'header-left header-left--compact';

  const menuClone = menuContainer.cloneNode(true);
  const logoClone = logo.cloneNode(true);
  menuClone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  logoClone.removeAttribute('id');

  left.appendChild(menuClone);
  left.appendChild(logoClone);
  content.appendChild(left);
  floating.appendChild(content);
  document.body.appendChild(floating);

  const updateFloatingHeader = () => {
    const rect = sourceHeader.getBoundingClientRect();
    const visible = sourceHeader.offsetParent !== null && rect.bottom <= 0;
    if (visible && !floating.classList.contains('visible')) {
      sourceHeader.querySelectorAll('.dropdown-menu.show').forEach(m => m.classList.remove('show'));
    }
    floating.classList.toggle('visible', visible);
  };

  window.addEventListener('scroll', updateFloatingHeader, { passive: true });
  window.addEventListener('resize', updateFloatingHeader, { passive: true });
  requestAnimationFrame(updateFloatingHeader);

  sourceHeader.dataset.floatingReady = 'true';
}

function setupFloatingHeaders() {
  document.querySelectorAll('.header, .app-header').forEach(createFloatingHeader);
}

function getResponsiveTableMinWidth(table) {
  if (table.matches('.dashboard-cleanliness-table')) return '520px';
  if (table.matches('.dashboard-detail-table')) return '760px';
  if (table.matches('.dashboard-pool-table, .pool-table')) return '1200px';
  if (table.matches('.training-schedule-table')) return '980px';
  if (table.matches('.attendance-table, .test-rubric-table')) return '900px';
  if (table.matches('.employee-table')) return '980px';
  if (table.matches('.sanitation-table--settings')) return '420px';
  if (table.matches('.sanitation-table')) return '700px';
  if (table.matches('.resource-table-admin')) return '980px';
  if (table.matches('.resource-table')) return '760px';
  return '720px';
}

function wrapResponsiveTables(root = document) {
  const tables = root.querySelectorAll('table');
  tables.forEach((table) => {
    table.style.setProperty('--table-min-width', getResponsiveTableMinWidth(table));
    const existingWrapper = table.closest('.table-scroll-wrap');
    if (existingWrapper) {
      ensureTableScrollShell(existingWrapper);
      bindTableScrollShadow(existingWrapper);
      updateTableScrollShadow(existingWrapper);
      return;
    }
    if (table.closest('.rules-table')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'table-scroll-wrap';
    const shell = document.createElement('div');
    shell.className = 'table-scroll-shell';
    table.parentNode.insertBefore(shell, table);
    shell.appendChild(wrapper);
    wrapper.appendChild(table);
    bindTableScrollShadow(wrapper);
  });
}

function ensureTableScrollShell(wrapper) {
  if (!wrapper || wrapper.parentElement?.classList.contains('table-scroll-shell')) return wrapper?.parentElement || null;
  const shell = document.createElement('div');
  shell.className = 'table-scroll-shell';
  wrapper.parentNode.insertBefore(shell, wrapper);
  shell.appendChild(wrapper);
  return shell;
}

function updateTableScrollShadow(wrapper) {
  if (!wrapper) return;
  const shell = ensureTableScrollShell(wrapper) || wrapper;
  const hasOverflow = wrapper.scrollWidth > wrapper.clientWidth + 2;
  const hasRight = hasOverflow && (wrapper.scrollLeft + wrapper.clientWidth) < (wrapper.scrollWidth - 2);
  const hasLeft = hasOverflow && wrapper.scrollLeft > 2;
  wrapper.classList.toggle('has-overflow-right', hasRight);
  wrapper.classList.toggle('has-overflow-left', hasLeft);
  wrapper.classList.toggle('has-overflow', hasOverflow);
  shell.classList.toggle('has-overflow-right', hasRight);
  shell.classList.toggle('has-overflow-left', hasLeft);
  shell.classList.toggle('has-overflow', hasOverflow);
  shell.style.setProperty('--table-scroll-shadow-height', `${Math.max(0, wrapper.clientHeight - 8)}px`);
}

function bindTableScrollShadow(wrapper) {
  if (!wrapper || wrapper.dataset.shadowBound === 'true') return;
  wrapper.dataset.shadowBound = 'true';
  const refresh = () => updateTableScrollShadow(wrapper);
  wrapper.addEventListener('scroll', refresh, { passive: true });
  window.addEventListener('resize', refresh, { passive: true });
  requestAnimationFrame(refresh);
  setTimeout(refresh, 100);
  setTimeout(refresh, 500);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(refresh).observe(wrapper);
  }
}

function observeResponsiveTables() {
  if (!document.body || document.body.dataset.tableObserverReady === 'true') return;
  document.body.dataset.tableObserverReady = 'true';

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches?.('table')) {
          wrapResponsiveTables(node.parentElement || document);
          return;
        }
        if (node.querySelector?.('table')) {
          wrapResponsiveTables(node);
        }
      });
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// ============================================================
// SETTINGS MODAL
// ============================================================

function showSharedModalOverlay() {
  const overlay = document.getElementById('settingsOverlay');
  if (!overlay) return;
  overlay.style.display = 'block';
  requestAnimationFrame(() => overlay.classList.add('visible'));
}

function hideSharedModalOverlayIfUnused() {
  const overlay = document.getElementById('settingsOverlay');
  if (!overlay) return;
  const settingsModal = document.getElementById('settingsModal');
  const feedbackModal = document.getElementById('feedbackModal');
  const settingsOpen = settingsModal?.classList.contains('visible');
  const feedbackOpen = feedbackModal?.classList.contains('visible');
  if (settingsOpen || feedbackOpen) return;
  overlay.classList.remove('visible');
  setTimeout(() => {
    if (!settingsModal?.classList.contains('visible') && !feedbackModal?.classList.contains('visible')) {
      overlay.style.display = 'none';
    }
  }, 250);
}

window.openSettings = function () {
  ensureAccountManagementSection();
  updateSettingsModalForRole();
  const modal = document.getElementById('settingsModal');
  document.querySelectorAll('.dropdown-menu.show').forEach(m => m.classList.remove('show'));
  showSharedModalOverlay();
  if (modal) {
    modal.style.display = 'block';
    requestAnimationFrame(() => modal.classList.add('visible'));
  }
};

function getAgreementDocIdForContext(context) {
  const role = (context?.role || 'user').toString().trim().toLowerCase();
  const email = (context?.email || '').toString().trim().toLowerCase();
  const username = (context?.username || '').toString().trim().toLowerCase();
  const employeeId = (context?.employeeId || email || username || '').toString().trim();
  return email ? `email:${email}` : `${role}:${username || employeeId || 'unknown-user'}`;
}

function setAccountManagementMessage(text, isError = false) {
  const msg = document.getElementById('accountManagementMessage');
  if (!msg) return;
  msg.textContent = text || '';
  msg.classList.toggle('error', !!text && isError);
  msg.classList.toggle('success', !!text && !isError);
}

function ensureAccountManagementSection() {
  const modalContent = document.querySelector('#settingsModal .settings-modal-content');
  if (!modalContent || document.getElementById('accountManagementSection')) return;

  const section = document.createElement('section');
  section.className = 'settings-section settings-group account-management-section';
  section.id = 'accountManagementSection';
  section.innerHTML = `
    <h3>Account Management</h3>
    <p class="section-subtitle" id="accountManagementDescription">
      Permanently delete the currently signed-in PoolPro account.
    </p>
    <button type="button" class="submit-btn danger-button" id="deleteCurrentAccountBtn">Delete Account</button>
    <p class="form-message" id="accountManagementMessage"></p>
  `;

  const scrollBody = modalContent.querySelector(':scope > .settings-modal-scroll');
  if (scrollBody) scrollBody.prepend(section);
  else {
    const header = modalContent.querySelector('.modal-header');
    if (header) header.insertAdjacentElement('afterend', section);
    else modalContent.prepend(section);
  }
}

function updateSettingsModalForRole() {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;

  const lifeguard = isLifeguardSession() && !isSupervisor();
  modal.classList.toggle('lifeguard-settings-view', lifeguard);
  modal.querySelectorAll('.settings-section').forEach((section) => {
    section.style.display = lifeguard && section.id !== 'accountManagementSection' ? 'none' : '';
  });
  if (lifeguard) {
    document.getElementById('accountManagementSection')?.classList.remove('collapsed');
  }

  const description = document.getElementById('accountManagementDescription');
  if (description) {
    description.textContent = lifeguard
      ? 'Permanently delete your lifeguard PoolPro account. This removes your login record and employee profile, then signs you out.'
      : 'Permanently delete the currently signed-in PoolPro account, then sign out.';
  }
}

async function reauthenticateAccountForDeletion(email, password) {
  const normalizedEmail = (email || '').trim().toLowerCase();
  if (!normalizedEmail || !password) throw new Error('Email and password are required.');

  if (auth.currentUser && (auth.currentUser.email || '').trim().toLowerCase() === normalizedEmail) {
    const credential = EmailAuthProvider.credential(auth.currentUser.email, password);
    await reauthenticateWithCredential(auth.currentUser, credential);
    return auth.currentUser;
  }

  const credential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
  return credential.user;
}

async function removeEmployeeRecordForAccount(email) {
  const normalizedEmail = (email || '').trim().toLowerCase();
  if (!normalizedEmail) return;

  await loadEmployees();
  const before = employeesData.length;
  employeesData = employeesData.filter((employee) => normalizeEmployeeRecord(employee).email !== normalizedEmail);
  if (employeesData.length !== before) {
    await saveEmployees();
    renderEmployeesTable();
  }
}

function isDeletedAccountMatch(value, identifiers) {
  const normalized = (value || '').toString().trim().toLowerCase();
  return !!normalized && identifiers.has(normalized);
}

function redactedIdentityPatch() {
  return {
    firstName: 'Redacted',
    lastName: 'Redacted',
    employeeId: 'Redacted',
    email: 'Redacted',
    submitterEmail: 'Redacted',
    phone: 'Redacted',
    username: 'Redacted',
    submitterName: 'Redacted',
  };
}

async function commitBatchChunks(batchUpdates) {
  for (let i = 0; i < batchUpdates.length; i += 400) {
    const batch = writeBatch(db);
    batchUpdates.slice(i, i + 400).forEach(({ ref, data }) => {
      batch.update(ref, data);
    });
    await batch.commit();
  }
}

async function redactCollectionIdentity(collectionName, identifiers, fieldsToCheck) {
  const snap = await getDocs(collection(db, collectionName));
  const updates = [];
  snap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const matched = fieldsToCheck.some((field) => isDeletedAccountMatch(data[field], identifiers));
    if (matched) updates.push({ ref: docSnap.ref, data: redactedIdentityPatch() });
  });
  if (updates.length) await commitBatchChunks(updates);
}

async function redactTrainingScheduleIdentity(identifiers) {
  const scheduleRef = doc(db, 'settings', 'trainingSchedule');
  const snap = await getDoc(scheduleRef);
  if (!snap.exists()) return;

  const data = snap.data() || {};
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  let changed = false;
  const redactedSessions = sessions.map((session) => {
    if (!Array.isArray(session.attendees)) return session;
    const attendees = session.attendees.map((attendee) => {
      const matched = ['employeeId', 'email', 'phone', 'firstName', 'lastName', 'name'].some((field) =>
        isDeletedAccountMatch(attendee?.[field], identifiers)
      );
      if (!matched) return attendee;
      changed = true;
      return {
        ...attendee,
        firstName: 'Redacted',
        lastName: 'Redacted',
        name: 'Redacted',
        email: 'Redacted',
        employeeId: 'Redacted',
        phone: 'Redacted',
      };
    });
    return { ...session, attendees };
  });

  if (changed) {
    await setDoc(scheduleRef, { sessions: redactedSessions }, { merge: true });
  }
}

async function redactDeletedAccountData(context) {
  const email = (context?.email || '').trim().toLowerCase();
  const username = (context?.username || '').trim().toLowerCase();
  const employeeId = (context?.employeeId || '').trim().toLowerCase();
  const identifiers = new Set([email, username, employeeId].filter(Boolean));
  if (!identifiers.size) return;

  await Promise.all([
    redactCollectionIdentity('poolSubmissions', identifiers, ['employeeId', 'email', 'submitterEmail', 'username']),
    redactCollectionIdentity('dutySubmissions', identifiers, ['submitterEmail', 'employeeId', 'email', 'username']),
    redactCollectionIdentity('managerialReports', identifiers, ['submitterEmail', 'employeeId', 'email', 'username']),
    redactCollectionIdentity('trainingSignups', identifiers, ['employeeId', 'email', 'username']),
    redactCollectionIdentity('operationalStatusLogs', identifiers, ['employeeId', 'email', 'submitterEmail', 'username']),
    redactTrainingScheduleIdentity(identifiers),
  ]);
}

async function deleteFirebaseAuthCredentialForAccount(context, password = '') {
  const email = (context?.email || '').trim().toLowerCase();
  const username = (context?.username || '').trim().toLowerCase();
  if (!email) return;

  if (auth.currentUser && (auth.currentUser.email || '').trim().toLowerCase() === email) {
    if (password) {
      const credential = EmailAuthProvider.credential(auth.currentUser.email, password);
      await reauthenticateWithCredential(auth.currentUser, credential);
    }
    await deleteUser(auth.currentUser);
    return;
  }

  if (context?.role !== 'lifeguard' || !username) return;

  const response = await fetch(DELETE_AUTH_USER_FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, username }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error || 'Unable to delete Firebase Auth credentials.');
  }
}

async function handleDeleteCurrentAccount() {
  const btn = document.getElementById('deleteCurrentAccountBtn');
  const context = getCurrentAgreementContext();
  const role = context?.role || '';
  const email = (context?.email || '').trim().toLowerCase();
  const username = (context?.username || '').trim().toLowerCase();

  setAccountManagementMessage('');
  if (!context || !email) {
    setAccountManagementMessage('Sign in before deleting an account.', true);
    return;
  }

  const confirmation = prompt(`Type DELETE to permanently delete the ${role} account for ${email}.`);
  if (confirmation !== 'DELETE') return;

  const passwordRequired = role !== 'lifeguard';
  const password = passwordRequired ? prompt('Enter your password to confirm account deletion:') : '';
  if (passwordRequired && !password) return;

  if (role === 'lifeguard' && !username) {
    setAccountManagementMessage('This lifeguard session is missing its username. Sign out and sign in again before deleting the account.', true);
    return;
  }

  if (btn) btn.disabled = true;
  accountDeletionInProgress = true;
  setAccountManagementMessage('Deleting account...');

  try {
    if (passwordRequired) {
      await reauthenticateAccountForDeletion(email, password);
    }
    await deleteFirebaseAuthCredentialForAccount(context, password);
    await redactDeletedAccountData(context);

    if (role === 'lifeguard') {
      await deleteDoc(doc(db, 'lifeguardAccounts', username));
      await removeEmployeeRecordForAccount(email);
    }

    await deleteDoc(doc(db, 'userAgreements', getAgreementDocIdForContext(context))).catch(() => {});

    setAccountManagementMessage('Account deleted. Signing out...');
    setTimeout(() => {
      window.logout();
    }, 500);
  } catch (err) {
    console.error('[PoolPro] Unable to delete account:', err);
    accountDeletionInProgress = false;
    if (btn) btn.disabled = false;
    const code = err?.code || '';
    const friendly = code === 'auth/wrong-password' || code === 'auth/invalid-credential'
      ? 'Incorrect password. Account deletion cancelled.'
      : code === 'auth/requires-recent-login'
        ? 'Please sign out, sign back in, and try deleting the account again.'
        : (err?.message || 'Unable to delete this account right now.');
    setAccountManagementMessage(friendly, true);
  }
}

function setupAccountManagement() {
  ensureAccountManagementSection();
  updateSettingsModalForRole();
  const btn = document.getElementById('deleteCurrentAccountBtn');
  if (!btn || btn.dataset.accountDeleteBound === 'true') return;
  btn.dataset.accountDeleteBound = 'true';
  btn.addEventListener('click', handleDeleteCurrentAccount);
}

window.closeSettings = function () {
  const modal = document.getElementById('settingsModal');
  if (modal) {
    modal.classList.remove('visible');
    setTimeout(() => { modal.style.display = 'none'; }, 250);
  }
  setTimeout(hideSharedModalOverlayIfUnused, 250);
};

// Close settings modal when clicking the overlay
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'settingsOverlay') {
    const feedbackModal = document.getElementById('feedbackModal');
    if (feedbackModal?.classList.contains('visible')) {
      window.closeModal();
      return;
    }
    window.closeSettings();
  }
});

// ============================================================
// SUPERVISOR DASHBOARD
// ============================================================

function applyDashboardAccessMode() {
  const dashboard = document.getElementById('supervisorDashboard');
  if (!dashboard) return;
  const fullAccess = isSupervisor();
  const canViewChemDashboard = canAccessPoolChemistryDashboard();
  const tabs = document.getElementById('supervisorDashTabs');
  const title = dashboard.querySelector('.page-content-title');
  const chemPanel = document.getElementById('dashboardContent');
  const jobPanel = document.getElementById('jobFormsContent');
  if (!canViewChemDashboard) return;
  if (tabs) tabs.style.display = fullAccess ? '' : 'none';
  if (title) title.textContent = fullAccess ? 'Supervisor Dashboard' : 'Pool Chemistry Dashboard';
  if (!fullAccess) {
    document.querySelectorAll('[data-dash-tab]').forEach((tab) => tab.classList.toggle('active', tab.dataset.dashTab === 'chemistry'));
    if (chemPanel) chemPanel.style.display = '';
    if (jobPanel) jobPanel.style.display = 'none';
  }
}

window.goToDashboard = function () {
  document.querySelectorAll('.dropdown-menu.show').forEach(m => m.classList.remove('show'));
  if (!canAccessPoolChemistryDashboard()) {
    alert('You do not have permission to view the Pool Chemistry Dashboard.');
    return;
  }
  const dashboard = document.getElementById('supervisorDashboard');
  if (dashboard) {
    const mainForm = document.getElementById('mainForm');
    if (mainForm) mainForm.style.display = 'none';
    dashboard.classList.add('show');
    applyDashboardAccessMode();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    loadDashboardData();
  } else {
    // Navigate from training.html or other pages
    window.location.href = '../chem/chem.html#supervisorDashboard';
  }
};

// ============================================================
// LOGOUT
// ============================================================

window.logout = async function () {
  document.querySelectorAll('.dropdown-menu.show').forEach(m => m.classList.remove('show'));
  try {
    await signOut(auth);
  } catch (_) { /* ignore */ }
  try {
    localStorage.removeItem('loginToken');
    localStorage.removeItem('ChemLogSupervisor');
    localStorage.removeItem('chemlogRole');
    localStorage.removeItem(ROLE_PERMISSIONS_STORAGE_KEY);
    localStorage.removeItem(LIFEGUARD_SESSION_KEY);
    localStorage.removeItem('trainingSupervisorLoggedIn');
    localStorage.removeItem('training_supervisor_logged_in_v1');
    localStorage.removeItem('chemlogTrainingSupervisorLoggedIn');
    sessionStorage.clear();
  } catch (_) { /* ignore */ }
  const _parts = window.location.pathname.split('/').filter(Boolean);
  _parts.pop();
  const _subDirs = ['chem', 'Chem', 'training', 'Training', 'editor', 'Editor', 'main', 'Main', 'duties', 'Duties', 'managerial', 'Managerial', 'employees', 'Employees', 'testing', 'Testing', 'resources', 'Resources', 'operational', 'Operational'];
  const _last = _parts[_parts.length - 1] || '';
  window.location.href = (_subDirs.includes(_last) ? '../' : '') + 'index.html';
};

function clearSupervisorLoginState() {
  try {
    localStorage.removeItem('loginToken');
    localStorage.removeItem('ChemLogSupervisor');
    localStorage.removeItem('trainingSupervisorLoggedIn');
    localStorage.removeItem('training_supervisor_logged_in_v1');
    localStorage.removeItem('chemlogTrainingSupervisorLoggedIn');
    const hasLifeguardSession = !!getStoredLifeguardSession() || sessionStorage.getItem('chemlogRole') === 'lifeguard';
    if (!hasLifeguardSession) {
      localStorage.removeItem('chemlogRole');
      localStorage.removeItem(ROLE_PERMISSIONS_STORAGE_KEY);
    }
  } catch (_) { /* ignore */ }
}

function writeLifeguardSessionToSessionStorage(session) {
  if (!session) return;
  sessionStorage.setItem('chemlogRole', 'lifeguard');
  sessionStorage.setItem('chemlogEmployeeEmail', session.email || '');
  sessionStorage.setItem('chemlogEmployeeId', session.employeeId || session.email || '');
  sessionStorage.setItem('chemlogEmployeeUsername', session.username || '');
  sessionStorage.setItem('chemlogEmployeeFirstName', session.firstName || '');
  sessionStorage.setItem('chemlogEmployeeLastName', session.lastName || '');
}

function hasFreshSupervisorToken() {
  try {
    const token = JSON.parse(localStorage.getItem('loginToken') || 'null');
    return !!(token?.expires && Date.now() < Number(token.expires));
  } catch (_) {
    return false;
  }
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
      localStorage.removeItem(LIFEGUARD_SESSION_KEY);
      if (localStorage.getItem('chemlogRole') === 'lifeguard') localStorage.removeItem('chemlogRole');
      return null;
    }
    return session;
  } catch (_) {
    try {
      localStorage.removeItem(LIFEGUARD_SESSION_KEY);
    } catch (err) { /* ignore */ }
    return null;
  }
}

function restoreLifeguardSessionFromLocalStorage() {
  if (hasFreshSupervisorToken()) return null;
  const session = getStoredLifeguardSession();
  if (!session) return null;
  try {
    writeLifeguardSessionToSessionStorage(session);
    localStorage.setItem('chemlogRole', 'lifeguard');
  } catch (_) { /* ignore */ }
  return session;
}

function clearStoredLifeguardSession() {
  try {
    localStorage.removeItem(LIFEGUARD_SESSION_KEY);
    if (localStorage.getItem('chemlogRole') === 'lifeguard') localStorage.removeItem('chemlogRole');
  } catch (_) { /* ignore */ }
}

function getStoredSupervisorEmail() {
  try {
    const token = JSON.parse(localStorage.getItem('loginToken') || 'null');
    return (token?.username || '').toString().trim().toLowerCase();
  } catch (_) {
    return '';
  }
}

function getCurrentAgreementContext() {
  restoreLifeguardSessionFromLocalStorage();
  const storedRole = hasFreshSupervisorToken()
    ? 'supervisor'
    : (sessionStorage.getItem('chemlogRole') || localStorage.getItem('chemlogRole') || '').toLowerCase();

  if (storedRole === 'lifeguard') {
    const email = (sessionStorage.getItem('chemlogEmployeeEmail') || sessionStorage.getItem('chemlogEmployeeId') || '').trim().toLowerCase();
    const username = (sessionStorage.getItem('chemlogEmployeeUsername') || '').trim().toLowerCase();
    const firstName = (sessionStorage.getItem('chemlogEmployeeFirstName') || '').trim();
    const lastName = (sessionStorage.getItem('chemlogEmployeeLastName') || '').trim();
    if (!email && !username) return null;
    return {
      role: 'lifeguard',
      email,
      username,
      firstName,
      lastName,
      displayName: `${firstName} ${lastName}`.trim(),
      employeeId: email || username,
    };
  }

  const email = (auth.currentUser?.email || getStoredSupervisorEmail()).trim().toLowerCase();
  if (!email) return null;
  return {
    role: 'supervisor',
    email,
    username: email,
    displayName: (auth.currentUser?.displayName || '').trim(),
    employeeId: email,
  };
}

async function enforceAgreementForCurrentUser() {
  if (agreementGatePromise) return agreementGatePromise;
  const context = getCurrentAgreementContext();
  if (!context) return true;

  agreementGatePromise = requireUserAgreement(context, {
    onDecline: async () => {
      await window.logout();
    },
  });

  try {
    return await agreementGatePromise;
  } finally {
    agreementGatePromise = null;
  }
}

// Firebase Auth sign-in bridge — used by home.js and training.js
window.supervisorSignIn = async function (email, password) {
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  // Sync localStorage flags so isSupervisor() works synchronously
  const expires = Date.now() + SESSION_WINDOW_MS;
  localStorage.setItem('loginToken', JSON.stringify({ username: email, expires }));
  localStorage.setItem('ChemLogSupervisor', 'true');
  localStorage.setItem('trainingSupervisorLoggedIn', 'true');
  localStorage.setItem('training_supervisor_logged_in_v1', 'true');
  localStorage.setItem('chemlogTrainingSupervisorLoggedIn', 'true');
  localStorage.setItem('chemlogRole', 'supervisor');
  localStorage.removeItem(LIFEGUARD_SESSION_KEY);

  const accepted = await enforceAgreementForCurrentUser();
  if (!accepted) {
    const err = new Error('You must accept the user agreement before using PoolPro.');
    err.code = 'agreement/required';
    throw err;
  }
  return userCredential;
};

// ============================================================
// EDITOR NAVIGATION
// ============================================================

window.goToEditor = function () {
  document.querySelectorAll('.dropdown-menu.show').forEach(m => m.classList.remove('show'));
  // Build a path that works from any subdirectory (chem/, training/, editor/, root)
  const parts = window.location.pathname.split('/').filter(Boolean);
  // Remove the filename (last element)
  parts.pop();
  // Remove segments that are known subdirectories to find the project root depth
  const subDirs = ['chem', 'training', 'editor', 'main', 'employees', 'testing', 'duties', 'managerial', 'resources', 'operational'];
  const lastPart = parts[parts.length - 1] || '';
  const stepsUp = subDirs.some(d => d.toLowerCase() === lastPart.toLowerCase()) ? 1 : 0;
  const prefix = stepsUp > 0 ? '../' : '';
  window.location.href = prefix + 'Editor/newRules.html';
};

// ============================================================
// TRAINING SETUP NAVIGATION
// ============================================================

window.goToTrainingSetup = function () {
  document.querySelectorAll('.dropdown-menu.show').forEach(m => m.classList.remove('show'));
  // Employees (non-supervisors) cannot access training setup
  const isEmployee = !!sessionStorage.getItem('chemlogEmployeeId');
  if (isEmployee && !isSupervisor()) return;

  if (window.showSupervisorView) {
    // Already on training.html — switch view directly
    if (isSupervisor()) {
      window.showSupervisorView();
    } else {
      const modal = document.getElementById('trainingLoginModal');
      if (modal) modal.style.display = 'flex';
    }
  } else {
    // On a different page — flag the intent and navigate to training
    sessionStorage.setItem('trainingIntentAdmin', '1');
    const parts = window.location.pathname.split('/').filter(Boolean);
    parts.pop();
    const subDirs = ['chem', 'Chem', 'training', 'Training', 'editor', 'Editor', 'main', 'Main', 'duties', 'Duties', 'managerial', 'Managerial', 'employees', 'Employees', 'testing', 'Testing', 'resources', 'Resources', 'operational', 'Operational'];
    const lastPart = parts[parts.length - 1] || '';
    const prefix = subDirs.includes(lastPart) ? '../' : '';
    window.location.href = prefix + 'Training/training.html';
  }
};

// ============================================================
// FEEDBACK MODAL
// ============================================================

window.closeModal = function () {
  const modal = document.getElementById('feedbackModal');
  if (!modal) return;
  const checkboxes = modal.querySelectorAll('.modal-rule-checkbox');
  if (checkboxes.length > 0) {
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    if (!allChecked) {
      alert('Please check off each item before closing.');
      return;
    }
  }
  modal.classList.remove('visible');
  setTimeout(() => {
    modal.style.display = 'none';
    hideSharedModalOverlayIfUnused();
  }, 250);
  const supSection = document.getElementById('supervisorNotifySection');
  if (supSection) supSection.style.display = 'none';
};

function forceCloseFeedbackModal() {
  const modal = document.getElementById('feedbackModal');
  if (!modal) return;
  modal.classList.remove('visible');
  modal.style.display = 'none';
  delete modal.dataset.submitterName;
  delete modal.dataset.poolName;
  delete modal.dataset.entry;
  delete modal.dataset.majorItems;
  const modalContent = document.getElementById('modalContent');
  if (modalContent) modalContent.innerHTML = '';
  const supSection = document.getElementById('supervisorNotifySection');
  if (supSection) supSection.style.display = 'none';
  hideSharedModalOverlayIfUnused();
}

function resetChemistryFormFields() {
  ['mainPoolPH', 'mainPoolCl', 'secondaryPoolPH', 'secondaryPoolCl'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['3', '4', '5'].forEach(n => {
    const ph = document.getElementById(`pool${n}PH`);
    const cl = document.getElementById(`pool${n}Cl`);
    if (ph) ph.value = '';
    if (cl) cl.value = '';
  });
  const poolLocation = document.getElementById('poolLocation');
  if (poolLocation) poolLocation.value = '';
  updateVisiblePoolSections(2);
}

window.showSupervisorNotify = function () {
  const section = document.getElementById('supervisorNotifySection');
  if (!section) return;
  // Populate supervisor dropdown from employee data
  const select = document.getElementById('supervisorSelect');
  if (select && select.options.length <= 1) {
    select.innerHTML = '';
    const withPhone = employeesData.filter(e => e.phone);
    if (withPhone.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No employees with phone numbers found';
      select.appendChild(opt);
    } else {
      withPhone.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.phone;
        opt.textContent = `${e.firstName || ''} ${e.lastName || ''}`.trim() || e.id;
        select.appendChild(opt);
      });
    }
  }
  section.style.display = 'block';
  // Scroll modal content to show the notify section
  const modal = document.getElementById('feedbackModal');
  if (modal) modal.scrollTop = modal.scrollHeight;
};

window.sendSupervisorNotification = function () {
  const select = document.getElementById('supervisorSelect');
  if (!select) return;
  const selected = Array.from(select.selectedOptions);
  if (selected.length === 0) { alert('Please select at least one supervisor.'); return; }

  const modal = document.getElementById('feedbackModal');
  const submitterName = modal?.dataset.submitterName || 'Unknown';
  const poolName = modal?.dataset.poolName || '';
  const entryStr = modal?.dataset.entry || '{}';
  const majorItems = modal?.dataset.majorItems || '';
  let entry = {};
  try { entry = JSON.parse(entryStr); } catch (_) {}

  // Build notification message
  let msg = `⚠️ POOL CHEMISTRY ALERT ⚠️\n`;
  msg += `Facility: ${poolName}\n`;
  msg += `Submitted by: ${submitterName}\n\n`;
  msg += `Pool readings:\n`;
  const poolFieldPairs = [
    { label: 'Main Pool', ph: 'mainPoolPH', cl: 'mainPoolCl' },
    { label: 'Secondary Pool', ph: 'secondaryPoolPH', cl: 'secondaryPoolCl' },
    { label: 'Pool 3', ph: 'pool3PH', cl: 'pool3Cl' },
    { label: 'Pool 4', ph: 'pool4PH', cl: 'pool4Cl' },
    { label: 'Pool 5', ph: 'pool5PH', cl: 'pool5Cl' },
  ];
  poolFieldPairs.forEach(p => {
    if (entry[p.ph] || entry[p.cl]) {
      msg += `  ${p.label} — pH: ${entry[p.ph] || '—'}, Cl: ${entry[p.cl] || '—'}\n`;
    }
  });
  if (majorItems) {
    msg += `\n⚠️ MAJOR CONCERNS:\n${majorItems}`;
  }

  const names = selected.map(o => o.textContent).join(', ');
  const phones = selected.map(o => o.value).join(', ');
  alert(`Message to ${names} (${phones}):\n\n${msg}\n\n(SMS delivery requires server-side integration.)`);
};

// ============================================================
// POOLS — populate all pool <select> dropdowns
// ============================================================

let poolsCache = [];

// Build market→pools map, sorted alphabetically within each market
function groupPoolsByMarket(pools) {
  const map = {};
  pools.forEach(pool => {
    // pools have a `markets` array or `market` string from the editor
    const rawMarkets = Array.isArray(pool.markets) ? pool.markets
      : (pool.market ? [pool.market] : []);
    const marketList = rawMarkets.length ? rawMarkets : ['Other'];
    // Use first market as primary grouping key
    const primary = marketList[0];
    if (!map[primary]) map[primary] = [];
    map[primary].push(pool);
  });
  // Sort pools alphabetically within each market
  Object.values(map).forEach(list =>
    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  );
  // Return markets sorted alphabetically
  return Object.keys(map).sort().map(m => ({ market: m, pools: map[m] }));
}

function populatePoolSelects(pools) {
  poolsCache = pools || [];
  window._poolsForDuties = pools || []; // expose for duties.js
  const groups = groupPoolsByMarket(pools);

  // Chemistry form pool select — grouped by market, value = pool.id
  const locationSelect = document.getElementById('poolLocation');
  if (locationSelect) {
    const current = locationSelect.value;
    // Keep only the first placeholder option
    while (locationSelect.options.length > 1) locationSelect.remove(1);
    // Remove any existing optgroups
    Array.from(locationSelect.querySelectorAll('optgroup')).forEach(g => g.remove());

    groups.forEach(({ market, pools: mPools }) => {
      const group = document.createElement('optgroup');
      group.label = market;
      mPools.forEach(pool => {
        const opt = document.createElement('option');
        opt.value = pool.id;
        opt.textContent = pool.name || pool.id;
        group.appendChild(opt);
      });
      locationSelect.appendChild(group);
    });
    if (current) locationSelect.value = current;
  }

  // Dashboard pool filter — flat list, value = pool.name
  const poolFilter = document.getElementById('poolFilter');
  if (poolFilter) {
    const current = poolFilter.value;
    while (poolFilter.options.length > 1) poolFilter.remove(1);
    Array.from(poolFilter.querySelectorAll('optgroup')).forEach(g => g.remove());
    if (poolFilter.options.length === 0) {
      const allOpt = document.createElement('option');
      allOpt.value = '';
      allOpt.textContent = 'All Pools';
      poolFilter.appendChild(allOpt);
    } else {
      poolFilter.options[0].textContent = 'All Pools';
    }
    groups.forEach(({ market, pools: mPools }) => {
      const group = document.createElement('optgroup');
      group.label = market;
      mPools.forEach(pool => {
        const opt = document.createElement('option');
        opt.value = pool.name || pool.id;
        opt.textContent = pool.name || pool.id;
        group.appendChild(opt);
      });
      poolFilter.appendChild(group);
    });
    if (current) poolFilter.value = current;
  }

  // Training signup home pool — grouped by market, value = pool.name
  const guardPool = document.getElementById('guardPool');
  if (guardPool) {
    const current = guardPool.value;
    while (guardPool.options.length > 1) guardPool.remove(1);
    Array.from(guardPool.querySelectorAll('optgroup')).forEach(g => g.remove());
    groups.forEach(({ market, pools: mPools }) => {
      const group = document.createElement('optgroup');
      group.label = market;
      mPools.forEach(pool => {
        const opt = document.createElement('option');
        opt.value = pool.name || pool.id;
        opt.textContent = pool.name || pool.id;
        group.appendChild(opt);
      });
      guardPool.appendChild(group);
    });
    if (current) guardPool.value = current;
  }

  // Attendance roster Home Pool select — grouped by market, value = pool.name
  const attendanceHomePool = document.getElementById('attendanceAddHomePool');
  if (attendanceHomePool && attendanceHomePool.tagName === 'SELECT') {
    const current = attendanceHomePool.value;
    while (attendanceHomePool.options.length > 1) attendanceHomePool.remove(1);
    Array.from(attendanceHomePool.querySelectorAll('optgroup')).forEach(g => g.remove());
    groups.forEach(({ market, pools: mPools }) => {
      const group = document.createElement('optgroup');
      group.label = market;
      mPools.forEach(pool => {
        const opt = document.createElement('option');
        opt.value = pool.name || pool.id;
        opt.textContent = pool.name || pool.id;
        group.appendChild(opt);
      });
      attendanceHomePool.appendChild(group);
    });
    if (current) attendanceHomePool.value = current;
    // Placeholder styling: grey when no value selected
    function syncPlaceholder() {
      attendanceHomePool.classList.toggle('is-placeholder', !attendanceHomePool.value);
    }
    syncPlaceholder();
    attendanceHomePool.removeEventListener('change', syncPlaceholder);
    attendanceHomePool.addEventListener('change', syncPlaceholder);
  }

  // Employee home pool select — grouped by market, value = pool.name
  const employeeHomePoolSelect = document.getElementById('employeeHomePoolInput');
  if (employeeHomePoolSelect) {
    const current = employeeHomePoolSelect.value;
    while (employeeHomePoolSelect.options.length > 1) employeeHomePoolSelect.remove(1);
    Array.from(employeeHomePoolSelect.querySelectorAll('optgroup')).forEach(g => g.remove());
    groups.forEach(({ market, pools: mPools }) => {
      const group = document.createElement('optgroup');
      group.label = market;
      mPools.forEach(pool => {
        const opt = document.createElement('option');
        opt.value = pool.name || pool.id;
        opt.textContent = pool.name || pool.id;
        group.appendChild(opt);
      });
      employeeHomePoolSelect.appendChild(group);
    });
    if (current) employeeHomePoolSelect.value = current;
  }

  // Training admin pool select — grouped by market, value = pool.name
  const trainingPoolSelect = document.getElementById('trainingPoolSelect');
  if (trainingPoolSelect) {
    const current = trainingPoolSelect.value;
    while (trainingPoolSelect.options.length > 1) trainingPoolSelect.remove(1);
    Array.from(trainingPoolSelect.querySelectorAll('optgroup')).forEach(g => g.remove());
    groups.forEach(({ market, pools: mPools }) => {
      const group = document.createElement('optgroup');
      group.label = market;
      mPools.forEach(pool => {
        const opt = document.createElement('option');
        opt.value = pool.name || pool.id;
        opt.textContent = pool.name || pool.id;
        group.appendChild(opt);
      });
      trainingPoolSelect.appendChild(group);
    });
    if (current) trainingPoolSelect.value = current;
  }

  // Duties page pool select — grouped by market, value = pool.name
  const dutiesPool = document.getElementById('dutiesPool');
  if (dutiesPool) {
    const current = dutiesPool.value;
    while (dutiesPool.options.length > 1) dutiesPool.remove(1);
    Array.from(dutiesPool.querySelectorAll('optgroup')).forEach(g => g.remove());
    groups.forEach(({ market, pools: mPools }) => {
      const group = document.createElement('optgroup');
      group.label = market;
      mPools.forEach(pool => {
        const opt = document.createElement('option');
        opt.value = pool.name || pool.id;
        opt.textContent = pool.name || pool.id;
        group.appendChild(opt);
      });
      dutiesPool.appendChild(group);
    });
    if (current) dutiesPool.value = current;
  }

  // Operational Status page facility select — grouped by market, value = pool.id
  const operationalPool = document.getElementById('operationalPoolLocation');
  if (operationalPool) {
    const current = operationalPool.value;
    while (operationalPool.options.length > 1) operationalPool.remove(1);
    Array.from(operationalPool.querySelectorAll('optgroup')).forEach(g => g.remove());
    groups.forEach(({ market, pools: mPools }) => {
      const group = document.createElement('optgroup');
      group.label = market;
      mPools.forEach(pool => {
        const opt = document.createElement('option');
        opt.value = pool.id;
        opt.textContent = pool.name || pool.id;
        group.appendChild(opt);
      });
      operationalPool.appendChild(group);
    });
    if (current) operationalPool.value = current;
    renderOperationalStatusLog();
  }

  // Refresh employee pool filter options when pools update
  populateEmployeePoolFilter(employeeMarketFilter);
  refreshResourceControls();
  renderResourcesPageTable();
  renderResourcesSettingsTable();

  const dashboard = document.getElementById('supervisorDashboard');
  if (dashboard?.classList.contains('show') && canAccessPoolChemistryDashboard()) {
    const activeDashTab = document.querySelector('[data-dash-tab].active')?.dataset.dashTab || 'chemistry';
    if (activeDashTab === 'jobforms') {
      loadJobFormSubmissions();
    } else if (allLogs.length) {
      renderDashboard(allLogs);
    } else {
      loadDashboardData();
    }
  }
}

// ============================================================
// AUTH HELPERS
// ============================================================

const SITE_DEVELOPER_EMAIL = 'samaharmon@icloud.com';
const ROLE_PERMISSIONS_STORAGE_KEY = 'poolproRolePermissionsProfile';
const ROLE_PERMISSIONS_DOC_ID = 'rolesPermissions';
const DELETE_AUTH_USER_FUNCTION_URL = 'https://us-central1-chemlog-43c08.cloudfunctions.net/deleteAuthUserByEmail';
const ROLE_DEFINITIONS = [
  { key: 'poolManager', label: 'Pool Manager' },
  { key: 'supervisor', label: 'Supervisor' },
];
const PERMISSION_DEFINITIONS = [
  { key: 'poolChemistryDashboard', label: 'Pool Chemistry Dashboard' },
  { key: 'managerialReport', label: 'Managerial Report' },
];
let rolesPermissionsData = {
  roles: { poolManager: [], supervisor: [] },
  permissions: {
    poolManager: { poolChemistryDashboard: false, managerialReport: false },
    supervisor: { poolChemistryDashboard: false, managerialReport: false },
  },
  individualPermissions: {},
};

function normalizeIdentityKey(value) {
  return (value || '').toString().trim().toLowerCase();
}

function getEmployeeRoleKey(employee) {
  const normalized = normalizeEmployeeRecord(employee || {});
  return normalizeIdentityKey(normalized.email || normalized.id || normalized.username);
}

function getCurrentIdentityKeys() {
  restoreLifeguardSessionFromLocalStorage();
  const keys = [
    auth.currentUser?.email,
    getStoredSupervisorEmail(),
    sessionStorage.getItem('chemlogEmployeeEmail'),
    sessionStorage.getItem('chemlogEmployeeId'),
    sessionStorage.getItem('chemlogEmployeeUsername'),
  ].map(normalizeIdentityKey).filter(Boolean);
  return [...new Set(keys)];
}

function normalizeRolesPermissionsData(data = {}) {
  const roles = data.roles || {};
  const permissions = data.permissions || {};
  const individual = data.individualPermissions || {};
  return {
    roles: {
      poolManager: Array.isArray(roles.poolManager) ? roles.poolManager.map(normalizeIdentityKey).filter(Boolean) : [],
      supervisor: Array.isArray(roles.supervisor) ? roles.supervisor.map(normalizeIdentityKey).filter(Boolean) : [],
    },
    permissions: {
      poolManager: {
        poolChemistryDashboard: !!permissions.poolManager?.poolChemistryDashboard,
        managerialReport: !!permissions.poolManager?.managerialReport,
      },
      supervisor: {
        poolChemistryDashboard: !!permissions.supervisor?.poolChemistryDashboard,
        managerialReport: !!permissions.supervisor?.managerialReport,
      },
    },
    individualPermissions: Object.fromEntries(Object.entries(individual).map(([key, value]) => [
      normalizeIdentityKey(key),
      {
        poolChemistryDashboard: !!value?.poolChemistryDashboard,
        managerialReport: !!value?.managerialReport,
      },
    ])),
  };
}

function getEffectiveRolePermissionsForKeys(keys) {
  const normalizedKeys = new Set((keys || []).map(normalizeIdentityKey).filter(Boolean));
  const effective = { poolChemistryDashboard: false, managerialReport: false };
  ROLE_DEFINITIONS.forEach(({ key }) => {
    const members = rolesPermissionsData.roles[key] || [];
    if (!members.some((memberKey) => normalizedKeys.has(memberKey))) return;
    PERMISSION_DEFINITIONS.forEach(({ key: permissionKey }) => {
      if (rolesPermissionsData.permissions[key]?.[permissionKey]) {
        effective[permissionKey] = true;
      }
    });
  });
  normalizedKeys.forEach((identityKey) => {
    const individual = rolesPermissionsData.individualPermissions?.[identityKey];
    if (!individual) return;
    PERMISSION_DEFINITIONS.forEach(({ key: permissionKey }) => {
      if (individual[permissionKey]) effective[permissionKey] = true;
    });
  });
  return effective;
}

function isDeveloperUser() {
  return getCurrentIdentityKeys().includes(SITE_DEVELOPER_EMAIL);
}

function getCurrentAccessProfile() {
  const keys = getCurrentIdentityKeys();
  const permissions = getEffectiveRolePermissionsForKeys(keys);
  if (isDeveloperUser()) {
    permissions.poolChemistryDashboard = true;
    permissions.managerialReport = true;
  }
  return {
    isDeveloper: isDeveloperUser(),
    permissions,
  };
}

function cacheCurrentAccessProfile() {
  try {
    localStorage.setItem(ROLE_PERMISSIONS_STORAGE_KEY, JSON.stringify(getCurrentAccessProfile()));
  } catch (_) { /* ignore */ }
}

function readCachedAccessProfile() {
  try {
    return JSON.parse(localStorage.getItem(ROLE_PERMISSIONS_STORAGE_KEY) || 'null') || null;
  } catch (_) {
    return null;
  }
}

async function loadRolesPermissions() {
  try {
    const snap = await getDoc(doc(db, 'settings', ROLE_PERMISSIONS_DOC_ID));
    rolesPermissionsData = normalizeRolesPermissionsData(snap.exists() ? snap.data() : {});
  } catch (err) {
    console.error('[PoolPro] Error loading roles and permissions:', err);
    rolesPermissionsData = normalizeRolesPermissionsData({});
  }
  cacheCurrentAccessProfile();
  window.setupDropdownVisibility?.();
  applyDashboardAccessMode();
  renderRolesPermissionsSettings();
  return rolesPermissionsData;
}

async function saveRolesPermissions() {
  rolesPermissionsData = normalizeRolesPermissionsData(rolesPermissionsData);
  await setDoc(doc(db, 'settings', ROLE_PERMISSIONS_DOC_ID), rolesPermissionsData, { merge: false });
  cacheCurrentAccessProfile();
  window.setupDropdownVisibility?.();
  applyDashboardAccessMode();
}

function hasPermission(permissionKey) {
  if (isDeveloperUser()) return true;
  const live = getCurrentAccessProfile();
  if (live.permissions?.[permissionKey]) return true;
  const cached = readCachedAccessProfile();
  return !!cached?.permissions?.[permissionKey];
}

function canAccessPoolChemistryDashboard() {
  return hasPermission('poolChemistryDashboard');
}

function canAccessManagerialReport() {
  return hasPermission('managerialReport');
}

window.poolProCanAccessManagerialReport = canAccessManagerialReport;

function isLifeguardSession() {
  try {
    restoreLifeguardSessionFromLocalStorage();
    const role = sessionStorage.getItem('chemlogRole') || localStorage.getItem('chemlogRole');
    const email = sessionStorage.getItem('chemlogEmployeeEmail') || sessionStorage.getItem('chemlogEmployeeId');
    const username = sessionStorage.getItem('chemlogEmployeeUsername');
    return role === 'lifeguard' && !!(email || username);
  } catch (_) {
    return false;
  }
}

function isSupervisor() {
  return isDeveloperUser();
}

// Show/hide supervisor-only dropdown items based on login state.
// Called on DOMContentLoaded and exported so training.js can re-call after login.
window.setupDropdownVisibility = function () {
  const sup = isSupervisor();
  const canViewChemDashboard = canAccessPoolChemistryDashboard();
  const lifeguard = isLifeguardSession() && !sup;
  ['training-setup', 'employees', 'testing', 'settings'].forEach(nav => {
    document.querySelectorAll(`[data-nav="${nav}"]`).forEach(el => {
      el.style.display = sup ? '' : 'none';
    });
  });
  document.querySelectorAll('[data-nav="dashboard"]').forEach((el) => {
    el.style.display = canViewChemDashboard ? '' : 'none';
    el.textContent = sup ? 'Supervisor Dashboard' : 'Pool Chemistry Dashboard';
  });
  document.querySelectorAll('[data-nav="managerial-report"]').forEach((el) => {
    el.style.display = canAccessManagerialReport() ? '' : 'none';
  });
  document.querySelectorAll('.lifeguard-only').forEach((item) => {
    item.style.display = lifeguard ? '' : 'none';
  });
  document.querySelectorAll('.dropdown-menu').forEach((m) => {
    m.classList.toggle('supervisor-active', sup || canViewChemDashboard);
    m.classList.toggle('lifeguard-active', lifeguard);
    m.querySelectorAll('.supervisor-only').forEach((item) => {
      item.classList.remove('supervisor-group-start', 'supervisor-group-end');
    });
    const visibleSupervisorItems = Array.from(m.querySelectorAll('.supervisor-only'))
      .filter((item) => item.style.display !== 'none');
    if (visibleSupervisorItems.length) {
      visibleSupervisorItems[0].classList.add('supervisor-group-start');
      visibleSupervisorItems[visibleSupervisorItems.length - 1].classList.add('supervisor-group-end');
    }
  });
};

function footerLogoPrefix() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const lastDir = parts.length > 1 ? parts[parts.length - 2] : '';
  const subDirs = ['chem', 'training', 'editor', 'employees', 'testing', 'main', 'duties', 'managerial', 'resources', 'operational', 'Chem', 'Training', 'Editor', 'Main', 'Duties', 'Managerial', 'Employees', 'Testing', 'Resources', 'Operational'];
  return subDirs.includes(lastDir) ? '../' : '';
}

function mountUnifiedFooter() {
  const prefix = footerLogoPrefix();
  document.querySelectorAll('.footer').forEach((footer) => {
    if (footer.dataset.unifiedFooter === 'true') return;
    footer.innerHTML = `
      <div class="site-footer-shell">
        <div class="site-footer-meta">
          <img src="${prefix}Images/Logos/logo.png" alt="PoolPro logo" class="site-footer-logo">
          <span class="site-footer-divider" aria-hidden="true"></span>
          <div class="site-footer-copy">
            <div class="site-footer-title">PoolPro v3.1</div>
            <div class="site-footer-date">Published April 2026</div>
          </div>
        </div>
        <div class="site-footer-company-row">Capital City Aquatics &amp; Upstate Pool Management</div>
      </div>
    `;
    footer.dataset.unifiedFooter = 'true';
  });
}

function removeSiteAppearanceSections() {
  document.querySelectorAll('#settingsModal .settings-section').forEach((section) => {
    const heading = section.querySelector(':scope > h3, :scope > .settings-section-toggle .settings-section-title');
    const label = heading?.textContent?.trim().toLowerCase() || '';
    if (label === 'site appearance') {
      section.remove();
    }
  });
}

function ensureSettingsModalScrollBody() {
  const modalContent = document.querySelector('#settingsModal .settings-modal-content');
  if (!modalContent || modalContent.querySelector(':scope > .settings-modal-scroll')) return;

  const header = modalContent.querySelector(':scope > .modal-header');
  const scrollBody = document.createElement('div');
  scrollBody.className = 'settings-modal-scroll';

  Array.from(modalContent.children).forEach((child) => {
    if (child !== header) scrollBody.appendChild(child);
  });

  modalContent.appendChild(scrollBody);
}

// ============================================================
// POOL SECTIONS — show/hide pools 3-5 based on pool config
// ============================================================

function updateVisiblePoolSections(numPools) {
  ['pool3Section', 'pool4Section', 'pool5Section'].forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (i + 3 <= (numPools || 2)) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });
}

function updatePoolSectionTitles(pool) {
  const sectionIds = ['mainPoolSection', 'secondaryPoolSection', 'pool3Section', 'pool4Section', 'pool5Section'];
  const defaultNames = ['Pool 1 (Main Pool)', 'Pool 2', 'Pool 3', 'Pool 4', 'Pool 5'];
  const rulesForPools = pool?.rules?.pools;

  sectionIds.forEach((id, idx) => {
    const section = document.getElementById(id);
    if (!section) return;
    const h3 = section.querySelector('h3');
    if (!h3) return;
    const customName = Array.isArray(rulesForPools) && rulesForPools[idx]?.poolName
      ? rulesForPools[idx].poolName
      : null;
    h3.textContent = customName || defaultNames[idx];
  });
}

// ============================================================
// CHEMISTRY FORM — submit to Firestore
// ============================================================

function getLoggedInEmployeeName() {
  const empId = sessionStorage.getItem('chemlogEmployeeEmail') || sessionStorage.getItem('chemlogEmployeeId');
  if (empId && employeesData.length) {
    const emp = employeesData.find(e =>
      String(e.email || '').toLowerCase() === String(empId).toLowerCase() ||
      String(e.id || '').toLowerCase() === String(empId).toLowerCase()
    );
    if (emp) return { firstName: emp.firstName || '', lastName: emp.lastName || '' };
  }
  const sessionFirstName = sessionStorage.getItem('chemlogEmployeeFirstName') || '';
  const sessionLastName = sessionStorage.getItem('chemlogEmployeeLastName') || '';
  if (sessionFirstName || sessionLastName) {
    return { firstName: sessionFirstName, lastName: sessionLastName };
  }
  // Fallback: supervisor name from localStorage if set
  try {
    const token = localStorage.getItem('loginToken');
    if (token) {
      const parsed = JSON.parse(token);
      if (parsed.firstName || parsed.lastName) {
        return { firstName: parsed.firstName || '', lastName: parsed.lastName || '' };
      }
    }
  } catch (_) { /* ignore */ }
  return { firstName: '', lastName: '' };
}

function setupChemForm() {
  const submitBtn = document.getElementById('submitBtn');
  if (!submitBtn) return;

  // Show/hide pool sections when location changes
  const locationSelect = document.getElementById('poolLocation');
  if (locationSelect) {
    locationSelect.addEventListener('change', () => {
      const pool = poolsCache.find(p => p.id === locationSelect.value);
      updateVisiblePoolSections(pool ? (pool.numPools || 2) : 2);
      updatePoolSectionTitles(pool);
    });
  }

  submitBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    const { firstName, lastName } = getLoggedInEmployeeName();
    const poolId = document.getElementById('poolLocation')?.value || '';

    if (!poolId) {
      alert('Please select a pool.');
      return;
    }

    const pool = poolsCache.find(p => p.id === poolId);
    const poolName = pool?.name || poolId;

    const entry = {
      timestamp: Timestamp.now(),
      firstName,
      lastName,
      employeeId: sessionStorage.getItem('chemlogEmployeeEmail') || sessionStorage.getItem('chemlogEmployeeId') || '',
      poolLocation: poolName,
      mainPoolPH: document.getElementById('mainPoolPH')?.value || '',
      mainPoolCl: document.getElementById('mainPoolCl')?.value || '',
      secondaryPoolPH: document.getElementById('secondaryPoolPH')?.value || '',
      secondaryPoolCl: document.getElementById('secondaryPoolCl')?.value || ''
    };

    // Include optional pool sections if visible
    ['3', '4', '5'].forEach(n => {
      const section = document.getElementById(`pool${n}Section`);
      if (section && !section.classList.contains('hidden')) {
        entry[`pool${n}PH`] = document.getElementById(`pool${n}PH`)?.value || '';
        entry[`pool${n}Cl`] = document.getElementById(`pool${n}Cl`)?.value || '';
      }
    });

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting…';
      await addDoc(collection(db, 'poolSubmissions'), entry);

      if (!FEEDBACK_RESPONSES_ENABLED) {
        forceCloseFeedbackModal();
        alert('Chemistry log submitted successfully!');
        resetChemistryFormFields();
        return;
      }

      await refreshSanitationSelections();
      const poolDoc = await getFreshPoolDoc(poolId, pool);
      const poolRules = poolDoc ? normalizePoolRules(poolDoc) : [];

      // Check concern levels for all submitted pools
      const numPools = poolDoc?.numPools || poolDoc?.poolCount || pool?.numPools || pool?.poolCount || 2;
      let allClear = true;
      for (let i = 0; i < numPools; i++) {
        const fields = poolFieldNames(i);
        const phVal = entry[fields.ph];
        const clVal = entry[fields.cl];
        const method = getSanitationMethodForPool(poolDoc || pool, i);
        const phRule = getRuleForReading(poolRules, i, method, 'ph', phVal);
        const clRule = getRuleForReading(poolRules, i, method, 'cl', clVal);
        if (phVal && getRuleConcernLevel(phRule) !== 'none') { allClear = false; break; }
        if (clVal && getRuleConcernLevel(clRule) !== 'none') { allClear = false; break; }
      }

      // Show feedback modal with rule responses
      const feedbackModal = document.getElementById('feedbackModal');
      const modalContent = document.getElementById('modalContent');
      if (feedbackModal && modalContent) {
        const submitterName = [firstName, lastName].filter(Boolean).join(' ') || 'Unknown';

        // Store submission data on modal for notify function
        feedbackModal.dataset.submitterName = submitterName;
        feedbackModal.dataset.poolName = poolName;
        feedbackModal.dataset.entry = JSON.stringify(entry);

        let html = `<h3 class="modal-facility-name">${poolName}</h3>`;
        let checkboxIdx = 0;
        let majorLines = [];

        for (let i = 0; i < numPools; i++) {
          const fields = poolFieldNames(i);
          const phVal = entry[fields.ph];
          const clVal = entry[fields.cl];
          if (!phVal && !clVal) continue;

          const method = getSanitationMethodForPool(poolDoc || pool, i);
          const methodLabel = getSanitationMethodLabel(method);
          const poolLabel = getFacilityPoolLabel(poolDoc || pool, i);
          const phRule = getRuleForReading(poolRules, i, method, 'ph', phVal);
          const clRule = getRuleForReading(poolRules, i, method, 'cl', clVal);
          const phResponse = getRuleResponse(phRule);
          const clResponse = getRuleResponse(clRule);

          if (phResponse || clResponse) {
            html += `<div class="modal-pool-section">`;
            html += `<h4 class="modal-pool-label">${escapeHtml(poolLabel)} <span class="modal-rule-method">(${escapeHtml(methodLabel)} rules)</span></h4>`;

            if (phResponse) {
              const isMajor = getRuleConcernLevel(phRule) === 'major';
              checkboxIdx++;
              html += `<div class="modal-rule-item${isMajor ? ' modal-rule-major' : ''}">`;
              html += `<label class="checkbox-item">`;
              html += `<input type="checkbox" class="modal-rule-checkbox" id="rule_cb_${checkboxIdx}">`;
              html += `<span><strong>pH ${escapeHtml(phVal)}:</strong> ${phResponse}</span>`;
              html += `</label>`;
              if (isMajor) {
                html += `<button type="button" class="notify-supervisor-btn" onclick="showSupervisorNotify()">Notify Supervisor</button>`;
                majorLines.push(`${poolLabel} (${methodLabel}) pH ${phVal}: ${stripHtml(phResponse)}`);
              }
              html += `</div>`;
            }

            if (clResponse) {
              const isMajor = getRuleConcernLevel(clRule) === 'major';
              checkboxIdx++;
              html += `<div class="modal-rule-item${isMajor ? ' modal-rule-major' : ''}">`;
              html += `<label class="checkbox-item">`;
              html += `<input type="checkbox" class="modal-rule-checkbox" id="rule_cb_${checkboxIdx}">`;
              html += `<span><strong>Cl ${escapeHtml(clVal)}:</strong> ${clResponse}</span>`;
              html += `</label>`;
              if (isMajor) {
                html += `<button type="button" class="notify-supervisor-btn" onclick="showSupervisorNotify()">Notify Supervisor</button>`;
                majorLines.push(`${poolLabel} (${methodLabel}) Cl ${clVal}: ${stripHtml(clResponse)}`);
              }
              html += `</div>`;
            }

            html += `</div>`;
          }
        }

        if (checkboxIdx === 0) {
          html += '<p style="margin-top:10px;">All chemistry values are within normal range.</p>';
        }

        feedbackModal.dataset.majorItems = majorLines.join('\n');
        modalContent.innerHTML = html;
        showSharedModalOverlay();
        feedbackModal.style.display = 'block';
        requestAnimationFrame(() => feedbackModal.classList.add('visible'));
      } else {
        alert('Chemistry log submitted successfully!');
      }

      // Fire confetti if all chemistry values are within acceptable range
      if (allClear && typeof confetti === 'function') {
        confetti({
          particleCount: 120,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#69140e', '#ffffff', '#c8a47e', '#ff6b6b', '#ffd700'],
        });
      }

      // Reset form fields
      resetChemistryFormFields();

    } catch (err) {
      console.error('[ChemLog] Error submitting chemistry log:', err);
      alert('Error submitting log. Please try again.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit';
    }
  });
}

// ============================================================
// SUPERVISOR DASHBOARD — market/tab/most-recent structure
// ============================================================

let allLogs = [];
let sanitationSelections = {}; // poolId::poolIdx -> 'bleach' | 'granular' | 'tablet' | 'off'
const PH_RULE_METHODS = ['muriaticAcid', 'noChanges'];
let dashboardPoolFilter = 'all';
let dashboardDateFilter = getTodayDateValue();
let dashboardChemPage = 1;
let dashboardChemPageByTable = {};
let dashboardJobPage = 1;
const DASHBOARD_PAGE_SIZE = 10;
const FILL_LINE_STATUS_OPTIONS = ['Off', 'On full blast', 'On halfway', 'On a trickle'];
const BLEACH_FEEDER_STATUS_OPTIONS = ['Not applicable', 'Off', '0 or L', '1', '1.5', '1.75', '2', '2.25', '2.5', '3', '4', '5', '6', '7', '8', '9', '10'];
let operationalStatusLogs = [];
let operationalStatusLatestMap = {};
let operationalStatusPageReady = false;

async function refreshSanitationSelections() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'sanitation'));
    sanitationSelections = snap.exists() ? (snap.data().pools || {}) : {};
  } catch (err) {
    console.warn('[ChemLog] Unable to refresh sanitation methods; using cached selections.', err);
  }
  return sanitationSelections;
}

async function getFreshPoolDoc(poolId, fallbackPool) {
  if (!poolId) return fallbackPool || null;
  try {
    const snap = await getDoc(doc(db, 'pools', poolId));
    if (!snap.exists()) return fallbackPool || null;
    const freshPool = { id: snap.id, ...snap.data() };
    const idx = poolsCache.findIndex((pool) => pool.id === freshPool.id);
    if (idx >= 0) poolsCache[idx] = freshPool;
    else poolsCache.push(freshPool);
    return freshPool;
  } catch (err) {
    console.warn('[ChemLog] Unable to fetch latest pool rules; using cached pool rules.', err);
    return fallbackPool || null;
  }
}

function getSanitationMethodForPool(poolDoc, poolIdx) {
  if (!poolDoc) return 'bleach';
  const poolId = poolDoc.id || '';
  const primaryName = (poolDoc.name || '').trim();
  return sanitationSelections[`${poolId}::${poolIdx}`] ||
    sanitationSelections[`${primaryName}::${poolIdx}`] ||
    sanitationSelections[poolId] ||
    sanitationSelections[primaryName] ||
    'bleach';
}

function getSanitationMethodLabel(method) {
  return {
    bleach: 'Bleach',
    granular: 'Granular',
    tablet: 'Tablet',
    off: 'No Changes',
  }[method] || 'Bleach';
}

function getPhRuleMethodForSanitation(method) {
  return method === 'off' ? 'noChanges' : 'muriaticAcid';
}

function getFacilityPoolLabel(poolDoc, poolIdx) {
  const rulesPool = poolDoc?.rules?.pools?.[poolIdx];
  const customName = (rulesPool?.poolName || '').trim();
  if (customName) return `Pool ${poolIdx + 1}: ${customName}`;
  if (poolIdx === 0) return 'Pool 1 (Main)';
  return `Pool ${poolIdx + 1}`;
}

// Map submitted pH select value → rule key used in pool docs
function phToRuleKey(val) {
  return { '< 7.0': 'lt_7_0', '7.0': '7_0', '7.2': '7_2', '7.4': '7_4',
           '7.6': '7_6', '7.8': '7_8', '8.0': '8_0', '> 8.0': 'gt_8_0' }[val] || null;
}

// Map submitted Cl select value → rule key used in pool docs
function clToRuleKey(val) {
  return { '0': '0', '1': '1', '2': '2', '3': '3',
           '5': '5', '7.5': '7_5', '10': '10', '> 10': 'gt_10' }[val] || null;
}

// Return CSS class for a concern level string
// Kept for backward compatibility with any external references
window.filterData = function () { loadDashboardData(); };

function concernClass(level) {
  if (level === 'minor' || level === 'yellow') return 'concern-minor';
  if (level === 'major' || level === 'red') return 'concern-major';
  return '';
}

// Normalize pool rules from either old flat format or new nested format.
// Returns an array where index 0 = pool 1, each entry has one object per sanitation method.
function normalizePoolRules(poolDoc) {
  // New format: poolDoc.rules.pools[i] = { bleach, granular, tablet, off }
  if (poolDoc.rules?.pools && Array.isArray(poolDoc.rules.pools) && poolDoc.rules.pools.length) {
    return poolDoc.rules.pools.map((poolRules = {}) => {
      const methods = ['bleach', 'granular', 'tablet', 'off'];
      const sharedPh = methods.reduce((acc, method) => ({
        ...acc,
        ...(poolRules[method]?.ph || {}),
      }), {});
      const phMethods = Object.fromEntries(
        PH_RULE_METHODS.map((method) => {
          const hasPhMethod = !!poolRules.phMethods?.[method];
          const directPh = poolRules.phMethods?.[method]?.ph || {};
          return [
            method,
            { ph: hasPhMethod ? directPh : sharedPh },
          ];
        })
      );
      const fallbackCl = methods
        .map(method => poolRules[method]?.cl || {})
        .find(cl => Object.keys(cl).length > 0) || {};

      return {
        ...poolRules,
        phMethods,
        bleach: poolRules.bleach || { ph: sharedPh, cl: fallbackCl },
        granular: poolRules.granular || { ph: sharedPh, cl: fallbackCl },
        tablet: poolRules.tablet || { ph: sharedPh, cl: fallbackCl },
        off: poolRules.off || { ph: sharedPh, cl: fallbackCl },
      };
    });
  }
  // Old flat format: pool1_ph_lt_7_0, pool1_ph_lt_7_0_level, pool1_cl_0, pool1_cl_0_level, etc.
  const maxPools = Math.max(2, Number(poolDoc.numPools || poolDoc.poolCount || 2));
  const pools = [];
  for (let i = 1; i <= maxPools; i++) {
    const ph = {}, cl = {};
    Object.keys(poolDoc).forEach(key => {
      const phPfx = `pool${i}_ph_`, clPfx = `pool${i}_cl_`;
      if (key.startsWith(phPfx) && !key.endsWith('_level')) {
        const rk = key.slice(phPfx.length);
        ph[rk] = { response: poolDoc[key], concernLevel: poolDoc[`${key}_level`] || 'none' };
      }
      if (key.startsWith(clPfx) && !key.endsWith('_level')) {
        const rk = key.slice(clPfx.length);
        cl[rk] = { response: poolDoc[key], concernLevel: poolDoc[`${key}_level`] || 'none' };
      }
    });
    pools.push({
      phMethods: {
        muriaticAcid: { ph },
        noChanges: { ph },
      },
      bleach: { ph, cl },
      granular: { ph, cl },
      tablet: { ph, cl },
      off: { ph, cl },
    });
  }
  return pools;
}

function getRuleForReading(poolRules, poolIdx, method, type, submittedValue) {
  if (!submittedValue) return null;
  const key = type === 'ph' ? phToRuleKey(submittedValue) : clToRuleKey(submittedValue);
  if (!key) return null;
  const poolRuleSet = poolRules?.[poolIdx] || {};
  if (type === 'ph' && poolRuleSet.phMethods) {
    const phMethod = getPhRuleMethodForSanitation(method);
    const phMethodRules = poolRuleSet.phMethods?.[phMethod];
    if (phMethodRules) return phMethodRules.ph?.[key] || null;
    return poolRuleSet.phMethods?.muriaticAcid?.ph?.[key] ||
      poolRuleSet[method]?.ph?.[key] ||
      null;
  }
  const selectedRules = poolRuleSet[method] || {};
  return selectedRules?.[type]?.[key] || null;
}

function getRuleResponse(rule) {
  return (rule?.response || '').toString().trim();
}

function getRuleConcernLevel(rule) {
  const raw = (rule?.concernLevel || rule?.concern || rule?.level || 'none').toString().toLowerCase();
  if (raw === 'major' || raw === 'red') return 'major';
  if (raw === 'minor' || raw === 'yellow') return 'minor';
  return 'none';
}

function stripHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = String(html || '');
  return (div.textContent || div.innerText || '').trim();
}

// Look up concern level for a pH value at a given pool facility + pool index (0-based)
function getPhConcernLevel(poolName, poolIdx, phValue) {
  const poolDoc = poolsCache.find(p => (p.name || p.id) === poolName);
  if (!poolDoc) return 'none';
  const method = getSanitationMethodForPool(poolDoc, poolIdx);
  const poolRules = normalizePoolRules(poolDoc);
  return getRuleConcernLevel(getRuleForReading(poolRules, poolIdx, method, 'ph', phValue));
}

// Look up concern level for a Cl value at a given pool facility + pool index (0-based)
function getClConcernLevel(poolName, poolIdx, clValue) {
  const poolDoc = poolsCache.find(p => (p.name || p.id) === poolName);
  if (!poolDoc) return 'none';
  const method = getSanitationMethodForPool(poolDoc, poolIdx);
  const poolRules = normalizePoolRules(poolDoc);
  return getRuleConcernLevel(getRuleForReading(poolRules, poolIdx, method, 'cl', clValue));
}

// Pool submission field names for each pool index (0-based)
function poolFieldNames(idx) {
  if (idx === 0) return { ph: 'mainPoolPH', cl: 'mainPoolCl' };
  if (idx === 1) return { ph: 'secondaryPoolPH', cl: 'secondaryPoolCl' };
  return { ph: `pool${idx + 1}PH`, cl: `pool${idx + 1}Cl` };
}

function getTodayDateValue() {
  return formatDateInputValue(new Date());
}

function formatDateInputValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toDateObject(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTimestampDisplay(value) {
  const date = toDateObject(value);
  return date ? date.toLocaleString() : '—';
}

function formatElapsedSince(value) {
  const date = toDateObject(value);
  if (!date) return '—';
  const diffMs = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes ? `${hours} hr ${remainingMinutes} min` : `${hours} hr`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days} day ${remainingHours} hr` : `${days} day`;
}

function getLogRespondentName(log) {
  const fullName = [log?.firstName, log?.lastName].filter(Boolean).join(' ').trim();
  return fullName || log?.submitterName || log?.employeeId || log?.submitterEmail || '—';
}

function normalizeOperationalStatusRecord(rawDoc, idOverride = '') {
  const data = rawDoc || {};
  const poolIndex = Number(data.poolIndex ?? data.poolIdx ?? 0);
  return {
    id: idOverride || data.id || '',
    facilityId: (data.facilityId || '').toString().trim(),
    facilityName: (data.facilityName || data.poolLocation || '').toString().trim(),
    market: (data.market || '').toString().trim(),
    poolIndex: Number.isFinite(poolIndex) ? poolIndex : 0,
    poolLabel: (data.poolLabel || '').toString().trim(),
    fillStatus: (data.fillStatus || '').toString().trim(),
    bleachStatus: (data.bleachStatus || '').toString().trim(),
    firstName: (data.firstName || '').toString().trim(),
    lastName: (data.lastName || '').toString().trim(),
    employeeId: (data.employeeId || '').toString().trim(),
    timestamp: data.timestamp || data.updatedAt || data.createdAt || null,
  };
}

function operationalStatusKey(facilityName, poolIdx, type) {
  return `${String(facilityName || '').trim()}::${Number(poolIdx || 0)}::${type}`;
}

function refreshOperationalStatusLatestMap() {
  const next = {};
  operationalStatusLogs.forEach((log) => {
    if (!log.facilityName) return;
    if (log.fillStatus) {
      const key = operationalStatusKey(log.facilityName, log.poolIndex, 'fill');
      if (!next[key]) next[key] = log;
    }
    if (log.bleachStatus) {
      const key = operationalStatusKey(log.facilityName, log.poolIndex, 'bleach');
      if (!next[key]) next[key] = log;
    }
  });
  operationalStatusLatestMap = next;
}

async function loadOperationalStatusLogs() {
  try {
    const q = query(collection(db, 'operationalStatusLogs'), orderBy('timestamp', 'desc'));
    const snap = await getDocs(q);
    operationalStatusLogs = snap.docs.map((docSnap) => normalizeOperationalStatusRecord(docSnap.data(), docSnap.id));
    refreshOperationalStatusLatestMap();
  } catch (err) {
    console.error('[PoolPro] Error loading operational status logs:', err);
    operationalStatusLogs = [];
    operationalStatusLatestMap = {};
  }
  return operationalStatusLogs;
}

function getLatestOperationalStatus(facilityName, poolIdx, type) {
  return operationalStatusLatestMap[operationalStatusKey(facilityName, poolIdx, type)] || null;
}

function getPoolRuleName(poolDoc, poolIdx) {
  return (poolDoc?.rules?.pools?.[poolIdx]?.poolName || '').toString().trim();
}

function getPoolSimpleLabel(poolDoc, poolIdx) {
  return getPoolRuleName(poolDoc, poolIdx) || (poolIdx === 0 ? 'Pool 1 (Main)' : `Pool ${poolIdx + 1}`);
}

function isBabyPool(poolDoc, poolIdx) {
  const label = `${getPoolSimpleLabel(poolDoc, poolIdx)} ${poolIdx === 0 ? 'main' : ''}`.toLowerCase();
  return /\b(baby|wading|kiddie|tot|splash)\b/.test(label);
}

function getElapsedMs(log) {
  const date = toDateObject(log?.timestamp);
  return date ? Math.max(0, Date.now() - date.getTime()) : 0;
}

function getFillLineConcernLevel(poolDoc, poolIdx, statusLog) {
  const status = statusLog?.fillStatus || '';
  const elapsed = getElapsedMs(statusLog);
  const hour = 60 * 60 * 1000;
  const minute = 60 * 1000;
  if (status === 'On full blast') {
    if (isBabyPool(poolDoc, poolIdx)) {
      if (elapsed > 25 * minute) return 'major';
      if (elapsed > 15 * minute) return 'minor';
      return 'none';
    }
    if (elapsed > 2 * hour) return 'major';
    if (elapsed > hour) return 'minor';
  }
  if (status === 'On halfway' && !isBabyPool(poolDoc, poolIdx)) {
    if (elapsed > 3 * hour) return 'major';
    if (elapsed >= 2 * hour) return 'minor';
  }
  return 'none';
}

function bleachStatusToNumber(status) {
  if (status === '0 or L') return 0;
  const num = Number(status);
  return Number.isFinite(num) ? num : null;
}

function getBleachFeederConcernLevel(statusLog) {
  const status = statusLog?.bleachStatus || '';
  if (!status || status === 'Not applicable' || status === 'Off') return 'none';
  const value = bleachStatusToNumber(status);
  if (value === null) return 'none';
  const elapsed = getElapsedMs(statusLog);
  const hour = 60 * 60 * 1000;
  const outOfRange = value > 2 || value < 1.5;
  if (!outOfRange) return 'none';
  if (elapsed > 4 * hour) return 'major';
  if (elapsed > 2 * hour) return 'minor';
  return 'none';
}

function createDashboardValueControl({ value, log, includeElapsed = false }) {
  const wrapper = document.createElement('span');
  wrapper.className = 'dash-value-cell';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dash-value-trigger';
  button.textContent = value || '—';
  wrapper.appendChild(button);

  const popover = document.createElement('div');
  popover.className = 'dash-value-popover';
  const rows = [
    ['Timestamp', formatTimestampDisplay(log?.timestamp)],
    ['Respondent', getLogRespondentName(log)],
  ];
  if (includeElapsed) rows.push(['Time Elapsed', formatElapsedSince(log?.timestamp)]);
  popover.innerHTML = rows.map(([label, rowValue]) =>
    `<div><strong>${escapeHtml(label)}:</strong> ${escapeHtml(rowValue)}</div>`
  ).join('');
  wrapper.appendChild(popover);
  return wrapper;
}

function fillDashboardValueCell(cell, { value, log, concern = 'none', includeElapsed = false } = {}) {
  if (!cell) return;
  cell.innerHTML = '';
  cell.className = concernClass(concern);
  cell.appendChild(createDashboardValueControl({ value: value || '—', log, includeElapsed }));
}

function getLatestChemistryLogForPool(logs, facilityName, poolIdx) {
  const fields = poolFieldNames(poolIdx);
  return logs.find((log) => log.poolLocation === facilityName && (log?.[fields.ph] || log?.[fields.cl])) || null;
}

function isDashboardDate(value, dateFilter) {
  const date = toDateObject(value);
  if (!date || !dateFilter) return false;
  return formatDateInputValue(date) === dateFilter;
}

function getSelectedDashboardMarkets() {
  try {
    const saved = JSON.parse(localStorage.getItem('chemlogMarkets') || '[]');
    return saved.length ? saved : null;
  } catch (_) {
    return null;
  }
}

function getDashboardMarketMap({ docs = true } = {}) {
  const marketMap = {};
  poolsCache.forEach((pool) => {
    const markets = Array.isArray(pool.markets) ? pool.markets
      : (pool.market ? [pool.market] : ['Other']);
    const primary = markets[0] || 'Other';
    if (!marketMap[primary]) marketMap[primary] = [];
    marketMap[primary].push(docs ? pool : (pool.name || pool.id));
  });

  Object.values(marketMap).forEach((list) => {
    list.sort((a, b) => {
      const aName = docs ? (a.name || a.id || '') : String(a || '');
      const bName = docs ? (b.name || b.id || '') : String(b || '');
      return aName.localeCompare(bName);
    });
  });

  return marketMap;
}

function getVisibleDashboardMarkets(marketMap) {
  const selectedMarkets = getSelectedDashboardMarkets();
  return selectedMarkets
    ? selectedMarkets.filter((market) => marketMap[market])
    : Object.keys(marketMap).sort();
}

function getPoolName(poolDoc) {
  return (poolDoc?.name || poolDoc?.id || '').toString().trim();
}

function getDashboardPoolOptions() {
  return groupPoolsByMarket(poolsCache).map(({ market, pools }) => ({
    market,
    pools: pools.map((pool) => getPoolName(pool)).filter(Boolean),
  }));
}

function renderDashboardFilterBar(container, onChange) {
  const filterBar = document.createElement('div');
  filterBar.className = 'training-filter-bar dashboard-filter-bar';

  const label = document.createElement('span');
  label.className = 'filter-by-label';
  label.textContent = 'Filter By:';

  const poolField = document.createElement('label');
  poolField.className = 'dashboard-filter-field';
  const poolLabel = document.createElement('span');
  poolLabel.textContent = 'Pool';
  const poolSelect = document.createElement('select');
  poolSelect.className = 'training-filter-select';
  poolSelect.setAttribute('aria-label', 'Filter dashboard by pool');
  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = 'All Pools';
  poolSelect.appendChild(allOption);

  getDashboardPoolOptions().forEach(({ market, pools }) => {
    const group = document.createElement('optgroup');
    group.label = market;
    pools.forEach((poolName) => {
      const option = document.createElement('option');
      option.value = poolName;
      option.textContent = poolName;
      group.appendChild(option);
    });
    poolSelect.appendChild(group);
  });
  poolSelect.value = dashboardPoolFilter;
  if (poolSelect.value !== dashboardPoolFilter) {
    dashboardPoolFilter = 'all';
    poolSelect.value = 'all';
  }

  const dateField = document.createElement('label');
  dateField.className = 'dashboard-filter-field';
  const dateLabel = document.createElement('span');
  dateLabel.textContent = 'Date';
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.className = 'training-filter-select dashboard-date-filter';
  dateInput.value = dashboardDateFilter || getTodayDateValue();
  dateInput.setAttribute('aria-label', 'Filter dashboard by date');

  poolField.appendChild(poolLabel);
  poolField.appendChild(poolSelect);
  dateField.appendChild(dateLabel);
  dateField.appendChild(dateInput);
  filterBar.appendChild(label);
  filterBar.appendChild(poolField);
  filterBar.appendChild(dateField);
  container.appendChild(filterBar);

  const handleChange = () => {
    dashboardPoolFilter = poolSelect.value || 'all';
    dashboardDateFilter = dateInput.value || getTodayDateValue();
    dashboardChemPage = 1;
    dashboardChemPageByTable = {};
    dashboardJobPage = 1;
    onChange?.();
  };

  poolSelect.addEventListener('change', handleChange);
  dateInput.addEventListener('change', handleChange);
}

function renderDashboardPagination(container, { page, totalRows, totalPages: suppliedTotalPages, onPageChange }) {
  const totalPages = suppliedTotalPages || Math.max(1, Math.ceil(totalRows / DASHBOARD_PAGE_SIZE));
  if (totalPages <= 1) return;

  const pagination = document.createElement('div');
  pagination.className = 'pagination dashboard-pagination';

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.textContent = 'Previous';
  prev.disabled = page <= 1;

  const pageSelect = document.createElement('select');
  pageSelect.className = 'training-filter-select dashboard-page-select';
  for (let i = 1; i <= totalPages; i++) {
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = `Page ${i} of ${totalPages}`;
    pageSelect.appendChild(option);
  }
  pageSelect.value = String(page);

  const next = document.createElement('button');
  next.type = 'button';
  next.textContent = 'Next';
  next.disabled = page >= totalPages;

  prev.addEventListener('click', () => onPageChange(Math.max(1, page - 1)));
  next.addEventListener('click', () => onPageChange(Math.min(totalPages, page + 1)));
  pageSelect.addEventListener('change', () => onPageChange(Number(pageSelect.value) || 1));

  pagination.appendChild(prev);
  pagination.appendChild(pageSelect);
  pagination.appendChild(next);
  container.appendChild(pagination);
}

async function loadDashboardData() {
  const container = document.getElementById('dashboardContent');
  if (!container) return;
  if (!canAccessPoolChemistryDashboard()) {
    container.innerHTML = '<p style="padding:16px;color:#c0392b;">You do not have permission to view the Pool Chemistry Dashboard.</p>';
    return;
  }
  applyDashboardAccessMode();
  container.innerHTML = '<p style="padding:16px;color:#666;">Loading…</p>';

  try {
    // Load sanitation method selections
    const sanSnap = await getDoc(doc(db, 'settings', 'sanitation'));
    sanitationSelections = sanSnap.exists() ? (sanSnap.data().pools || {}) : {};

    // Fetch all submissions, ordered newest first
    const q = query(collection(db, 'poolSubmissions'), orderBy('timestamp', 'desc'));
    const snap = await getDocs(q);
    allLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    await loadOperationalStatusLogs();

    renderDashboard(allLogs);
  } catch (err) {
    console.error('[ChemLog] Error loading dashboard data:', err);
    if (container) container.innerHTML = '<p style="color:red;padding:16px;">Error loading data. Check console.</p>';
  }
}

function fillDashboardRespondentCell(cell, log) {
  cell.innerHTML = '';
  const firstName = log?.firstName || '';
  const lastName = log?.lastName || '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ');
  if (!fullName) {
    cell.textContent = log?.submitterEmail || '—';
    return;
  }

  const empId = log?.employeeId || '';
  const empRecord = empId ? employeesData.find(e =>
    String(e.id || '').toLowerCase() === String(empId).toLowerCase() ||
    String(e.email || '').toLowerCase() === String(empId).toLowerCase()
  ) : null;
  const rawPhone = empRecord?.phone || '';
  const homePool = empRecord?.homePool || '—';
  const phoneDigits = getTenDigitPhone(rawPhone);
  const displayPhone = phoneDigits ? formatPhoneDisplay(phoneDigits) : '—';
  const phoneHref = phoneDigits ? `+1${phoneDigits}` : '';

  const nameWrapper = document.createElement('span');
  nameWrapper.className = 'dash-respondent-cell';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'dash-respondent-name';
  nameSpan.textContent = fullName;

  const tooltip = document.createElement('div');
  tooltip.className = 'dash-respondent-tooltip';
  const tooltipName = document.createElement('strong');
  tooltipName.textContent = fullName;
  const idLine = document.createElement('div');
  idLine.textContent = `ID: ${empId || '—'}`;
  const homePoolLine = document.createElement('div');
  homePoolLine.textContent = `Home Pool: ${homePool}`;
  const phoneLine = document.createElement('div');
  phoneLine.className = 'dash-phone-line';
  phoneLine.textContent = `Phone: ${displayPhone}`;

  tooltip.appendChild(tooltipName);
  tooltip.appendChild(idLine);
  tooltip.appendChild(homePoolLine);
  tooltip.appendChild(phoneLine);

  if (phoneHref) {
    const actions = document.createElement('div');
    actions.className = 'dash-phone-actions';

    const textLink = document.createElement('a');
    textLink.href = `sms:${phoneHref}`;
    textLink.textContent = 'Text';
    textLink.addEventListener('click', (event) => event.stopPropagation());

    const callLink = document.createElement('a');
    callLink.href = `tel:${phoneHref}`;
    callLink.textContent = 'Call';
    callLink.addEventListener('click', (event) => event.stopPropagation());

    actions.appendChild(textLink);
    actions.appendChild(callLink);
    tooltip.appendChild(actions);
  }

  nameWrapper.appendChild(nameSpan);
  nameWrapper.appendChild(tooltip);
  cell.appendChild(nameWrapper);
}

function getChemistryDetailRows(logs, facilityName, poolDoc) {
  const poolCount = Number(poolDoc?.numPools || poolDoc?.poolCount || 1);
  const rows = [];
  logs
    .filter((log) => log.poolLocation === facilityName && isDashboardDate(log.timestamp, dashboardDateFilter))
    .forEach((log) => {
      for (let i = 0; i < poolCount; i++) {
        const fields = poolFieldNames(i);
        const phVal = log?.[fields.ph] || '';
        const clVal = log?.[fields.cl] || '';
        if (!phVal && !clVal) continue;
        rows.push({ log, poolIdx: i, phVal, clVal });
      }
    });
  return rows;
}

function getChemistryLogsForPoolOnDate(logs, facilityName, poolIdx) {
  const fields = poolFieldNames(poolIdx);
  return logs
    .filter((log) => log.poolLocation === facilityName && isDashboardDate(log.timestamp, dashboardDateFilter))
    .filter((log) => log?.[fields.ph] || log?.[fields.cl]);
}

function getDashboardChemTablePageKey(market, poolIdx) {
  return `${market}::pool${poolIdx + 1}`;
}

function getDashboardChemTablePage(market, poolIdx, totalPages) {
  const key = getDashboardChemTablePageKey(market, poolIdx);
  const page = Math.min(Math.max(1, Number(dashboardChemPageByTable[key]) || 1), totalPages);
  dashboardChemPageByTable[key] = page;
  return page;
}

function renderChemistryPoolDetail(container, logs, poolDoc) {
  const facilityName = getPoolName(poolDoc);
  const rows = getChemistryDetailRows(logs, facilityName, poolDoc);
  const totalPages = Math.max(1, Math.ceil(rows.length / DASHBOARD_PAGE_SIZE));
  dashboardChemPage = Math.min(Math.max(1, dashboardChemPage), totalPages);
  const pageRows = rows.slice((dashboardChemPage - 1) * DASHBOARD_PAGE_SIZE, dashboardChemPage * DASHBOARD_PAGE_SIZE);

  const section = document.createElement('div');
  section.className = 'dashboard-market-section dashboard-single-pool-section';

  const heading = document.createElement('h2');
  heading.className = 'dashboard-market-heading';
  heading.textContent = facilityName || 'Selected Pool';
  section.appendChild(heading);

  const table = document.createElement('table');
  table.className = 'data-table dashboard-pool-table dashboard-detail-table';
  table.innerHTML = `
    <thead><tr>
      <th>Facility Name</th>
      <th>Pool</th>
      <th>pH</th>
      <th>Cl</th>
      <th>Fill Line/Hose</th>
      <th>Bleach Feeder Rate</th>
    </tr></thead>
  `;
  const tbody = document.createElement('tbody');

  if (!pageRows.length) {
    tbody.innerHTML = '<tr><td colspan="6">No pool chemistry submissions match the selected filters.</td></tr>';
  } else {
    pageRows.forEach(({ log, poolIdx, phVal, clVal }) => {
      const phConcern = phVal ? getPhConcernLevel(facilityName, poolIdx, phVal) : 'none';
      const clConcern = clVal ? getClConcernLevel(facilityName, poolIdx, clVal) : 'none';
      const fillLog = getLatestOperationalStatus(facilityName, poolIdx, 'fill');
      const bleachLog = getLatestOperationalStatus(facilityName, poolIdx, 'bleach');
      const fillConcern = getFillLineConcernLevel(poolDoc, poolIdx, fillLog);
      const bleachConcern = getBleachFeederConcernLevel(bleachLog);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(facilityName)}</td>
        <td>Pool ${poolIdx + 1}</td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
      `;
      const cells = tr.querySelectorAll('td');
      fillDashboardValueCell(cells[2], { value: phVal || '—', log, concern: phConcern });
      fillDashboardValueCell(cells[3], { value: clVal || '—', log, concern: clConcern });
      fillDashboardValueCell(cells[4], {
        value: fillLog?.fillStatus || '—',
        log: fillLog,
        concern: fillConcern,
        includeElapsed: true,
      });
      fillDashboardValueCell(cells[5], {
        value: bleachLog?.bleachStatus || '—',
        log: bleachLog,
        concern: bleachConcern,
        includeElapsed: true,
      });
      tbody.appendChild(tr);
    });
  }

  table.appendChild(tbody);
  section.appendChild(table);
  renderDashboardPagination(section, {
    page: dashboardChemPage,
    totalRows: rows.length,
    onPageChange: (nextPage) => {
      dashboardChemPage = nextPage;
      renderDashboard(logs);
    },
  });
  container.appendChild(section);
}

function renderDashboard(logs) {
  const container = document.getElementById('dashboardContent');
  if (!container) return;
  container.innerHTML = '';

  renderDashboardFilterBar(container, () => renderDashboard(logs));

  const marketMap = getDashboardMarketMap({ docs: true });
  const marketsToShow = getVisibleDashboardMarkets(marketMap);

  if (!marketsToShow.length) {
    container.insertAdjacentHTML('beforeend', '<p style="padding:16px;color:#666;">No markets selected. Enable markets in Settings.</p>');
    return;
  }

  if (dashboardPoolFilter !== 'all') {
    const selectedPool = poolsCache.find((pool) => getPoolName(pool) === dashboardPoolFilter);
    if (selectedPool) {
      renderChemistryPoolDetail(container, logs, selectedPool);
      wrapResponsiveTables(container);
    } else {
      container.insertAdjacentHTML('beforeend', '<p style="padding:16px;color:#666;">Selected pool was not found.</p>');
    }
    return;
  }

  marketsToShow.forEach(market => {
    const marketPools = marketMap[market] || [];
    if (!marketPools.length) return;

    // Max pools across all facilities in this market
    const maxPools = Math.max(...marketPools.map(p => p.numPools || p.poolCount || 2));

    // Create market section
    const section = document.createElement('div');
    section.className = 'dashboard-market-section';

    const heading = document.createElement('h2');
    heading.className = 'dashboard-market-heading';
    heading.textContent = market;
    section.appendChild(heading);

    // Tab bar
    const tabBar = document.createElement('div');
    tabBar.className = 'dashboard-tab-bar';
    const tabPanels = [];

    for (let i = 0; i < maxPools; i++) {
      const tabBtn = document.createElement('button');
      tabBtn.className = 'dashboard-tab-btn' + (i === 0 ? ' active' : '');
      tabBtn.textContent = `Pool ${i + 1}`;
      tabBtn.dataset.tabIdx = String(i);
      tabBar.appendChild(tabBtn);

      // Tab panel
      const panel = document.createElement('div');
      panel.className = 'dashboard-tab-panel' + (i === 0 ? ' active' : '');
      panel.dataset.tabIdx = String(i);

      const table = document.createElement('table');
      table.className = 'data-table dashboard-pool-table';
      table.innerHTML = `
        <thead><tr>
          <th>Facility Name</th>
          <th>pH</th>
          <th>Cl</th>
          <th>Fill Line/Hose</th>
          <th>Bleach Feeder Rate</th>
        </tr></thead>
      `;
      const tbody = document.createElement('tbody');

      // Sort facilities alphabetically, then render one same-day submission per facility on each page.
      const sortedPools = [...marketPools].sort((a, b) =>
        (a.name || '').localeCompare(b.name || ''));
      const eligiblePools = sortedPools
        .filter((poolDoc) => (poolDoc.numPools || poolDoc.poolCount || 1) > i)
        .map((poolDoc) => {
          const facilityName = poolDoc.name || poolDoc.id;
          return {
            poolDoc,
            facilityName,
            sameDayLogs: getChemistryLogsForPoolOnDate(logs, facilityName, i),
          };
        });
      const totalPages = Math.max(1, ...eligiblePools.map(({ sameDayLogs }) => sameDayLogs.length || 1));
      const currentPage = getDashboardChemTablePage(market, i, totalPages);
      const pageIndex = currentPage - 1;
      let renderedRows = 0;

      eligiblePools.forEach(({ poolDoc, facilityName, sameDayLogs }) => {
        const log = sameDayLogs[pageIndex] || null;
        if (currentPage > 1 && !log) return;
        const fields = poolFieldNames(i);
        const phVal = log?.[fields.ph] || '';
        const clVal = log?.[fields.cl] || '';
        const fillLog = getLatestOperationalStatus(facilityName, i, 'fill');
        const bleachLog = getLatestOperationalStatus(facilityName, i, 'bleach');

        const phConcern = phVal ? getPhConcernLevel(facilityName, i, phVal) : 'none';
        const clConcern = clVal ? getClConcernLevel(facilityName, i, clVal) : 'none';
        const fillConcern = getFillLineConcernLevel(poolDoc, i, fillLog);
        const bleachConcern = getBleachFeederConcernLevel(bleachLog);

        // Item 9: Consecutive major concern — check 2 most recent logs for this facility
        const facilityLogs = allLogs.filter(l => l.poolLocation === facilityName && (l?.[fields.ph] || l?.[fields.cl]));
        const recent2 = facilityLogs.slice(0, 2);
        const hasConsecutiveMajor = recent2.length >= 2 && ['ph', 'cl'].some(type => {
          const field = fields[type];
          return recent2.every(l => {
            const val = l[field] || '';
            if (!val) return false;
            const level = type === 'ph'
              ? getPhConcernLevel(facilityName, i, val)
              : getClConcernLevel(facilityName, i, val);
            return level === 'major';
          });
        });

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(facilityName)}</td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
        `;

        if (hasConsecutiveMajor) {
          tr.style.outline = '4px solid #8b0000';
        }

        const cells = tr.querySelectorAll('td');
        fillDashboardValueCell(cells[1], { value: phVal || '—', log, concern: phConcern });
        fillDashboardValueCell(cells[2], { value: clVal || '—', log, concern: clConcern });
        fillDashboardValueCell(cells[3], {
          value: fillLog?.fillStatus || '—',
          log: fillLog,
          concern: fillConcern,
          includeElapsed: true,
        });
        fillDashboardValueCell(cells[4], {
          value: bleachLog?.bleachStatus || '—',
          log: bleachLog,
          concern: bleachConcern,
          includeElapsed: true,
        });

        tbody.appendChild(tr);
        renderedRows += 1;
      });

      if (!renderedRows) {
        tbody.innerHTML = '<tr><td colspan="5">No previous same-day submissions for this page.</td></tr>';
      }

      table.appendChild(tbody);
      panel.appendChild(table);
      renderDashboardPagination(panel, {
        page: currentPage,
        totalPages,
        onPageChange: (nextPage) => {
          dashboardChemPageByTable[getDashboardChemTablePageKey(market, i)] = nextPage;
          renderDashboard(logs);
        },
      });
      tabPanels.push(panel);
    }

    // Tab switching logic
    tabBar.addEventListener('click', e => {
      const btn = e.target.closest('.dashboard-tab-btn');
      if (!btn) return;
      const idx = btn.dataset.tabIdx;
      tabBar.querySelectorAll('.dashboard-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      tabPanels.forEach(p => p.classList.toggle('active', p.dataset.tabIdx === idx));
    });

    section.appendChild(tabBar);
    tabPanels.forEach(p => section.appendChild(p));
    container.appendChild(section);
  });

  wrapResponsiveTables(container);
}

// ============================================================
// OPERATIONAL STATUS LOG
// ============================================================

function buildOperationalOptionGroup({ name, options, selected }) {
  const group = document.createElement('div');
  group.className = 'operational-switch-group';
  options.forEach((option) => {
    const label = document.createElement('label');
    label.className = 'operational-switch-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = option;
    input.checked = option === selected;
    const text = document.createElement('span');
    text.textContent = option;
    label.appendChild(input);
    label.appendChild(text);
    group.appendChild(label);
  });
  return group;
}

function setOperationalMessage(message, isError = false) {
  const el = document.getElementById('operationalStatusMessage');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('error', !!message && isError);
  el.classList.toggle('success', !!message && !isError);
}

function getOperationalSelectedFacility() {
  const select = document.getElementById('operationalPoolLocation');
  const poolId = select?.value || '';
  return poolsCache.find((pool) => pool.id === poolId) || null;
}

function renderOperationalStatusLog() {
  const cards = document.getElementById('operationalStatusCards');
  const submitBtn = document.getElementById('operationalStatusSubmit');
  if (!cards) return;

  const poolDoc = getOperationalSelectedFacility();
  cards.innerHTML = '';
  setOperationalMessage('');

  if (!poolDoc) {
    cards.innerHTML = '<p class="operational-empty-state">Select a facility to update fill line, hose, and bleach feeder statuses.</p>';
    if (submitBtn) submitBtn.disabled = true;
    return;
  }

  if (submitBtn) submitBtn.disabled = false;
  const facilityName = getPoolName(poolDoc);
  const poolCount = Math.max(1, Number(poolDoc.numPools || poolDoc.poolCount || 1));

  for (let idx = 0; idx < poolCount; idx++) {
    const fillLog = getLatestOperationalStatus(facilityName, idx, 'fill');
    const bleachLog = getLatestOperationalStatus(facilityName, idx, 'bleach');
    const poolLabel = getPoolSimpleLabel(poolDoc, idx);

    const card = document.createElement('section');
    card.className = 'operational-status-card';
    card.dataset.poolIndex = String(idx);

    const heading = document.createElement('h3');
    heading.textContent = poolLabel;
    card.appendChild(heading);

    const fillBlock = document.createElement('div');
    fillBlock.className = 'operational-control-block';
    fillBlock.innerHTML = `
      <div class="operational-control-heading">
        <span>Fill Line / Hose</span>
        <small>Current: ${escapeHtml(fillLog?.fillStatus || 'Not recorded')}</small>
      </div>
    `;
    fillBlock.appendChild(buildOperationalOptionGroup({
      name: `operational_fill_${idx}`,
      options: FILL_LINE_STATUS_OPTIONS,
      selected: fillLog?.fillStatus || 'Off',
    }));

    const bleachBlock = document.createElement('div');
    bleachBlock.className = 'operational-control-block';
    bleachBlock.innerHTML = `
      <div class="operational-control-heading">
        <span>Bleach Feeder Rate</span>
        <small>Current: ${escapeHtml(bleachLog?.bleachStatus || 'Not recorded')}</small>
      </div>
    `;
    bleachBlock.appendChild(buildOperationalOptionGroup({
      name: `operational_bleach_${idx}`,
      options: BLEACH_FEEDER_STATUS_OPTIONS,
      selected: bleachLog?.bleachStatus || 'Not applicable',
    }));

    card.appendChild(fillBlock);
    card.appendChild(bleachBlock);
    cards.appendChild(card);
  }
}

async function saveOperationalStatusLog() {
  const submitBtn = document.getElementById('operationalStatusSubmit');
  const poolDoc = getOperationalSelectedFacility();
  if (!poolDoc) {
    setOperationalMessage('Select a facility before submitting operational status.', true);
    return;
  }

  const facilityName = getPoolName(poolDoc);
  const poolCount = Math.max(1, Number(poolDoc.numPools || poolDoc.poolCount || 1));
  const market = Array.isArray(poolDoc.markets) ? (poolDoc.markets[0] || '') : (poolDoc.market || '');
  const { firstName, lastName } = getLoggedInEmployeeName();
  const employeeId = sessionStorage.getItem('chemlogEmployeeEmail') || sessionStorage.getItem('chemlogEmployeeId') || '';
  const writes = [];

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';
    }
    setOperationalMessage('Submitting status updates...');

    for (let idx = 0; idx < poolCount; idx++) {
      const fillStatus = document.querySelector(`input[name="operational_fill_${idx}"]:checked`)?.value || '';
      const bleachStatus = document.querySelector(`input[name="operational_bleach_${idx}"]:checked`)?.value || '';
      const latestFill = getLatestOperationalStatus(facilityName, idx, 'fill');
      const latestBleach = getLatestOperationalStatus(facilityName, idx, 'bleach');
      const fillChanged = fillStatus && fillStatus !== (latestFill?.fillStatus || '');
      const bleachChanged = bleachStatus && bleachStatus !== (latestBleach?.bleachStatus || '');
      if (!fillChanged && !bleachChanged) continue;

      const payload = {
        timestamp: Timestamp.now(),
        facilityId: poolDoc.id || '',
        facilityName,
        market,
        poolIndex: idx,
        poolLabel: getPoolSimpleLabel(poolDoc, idx),
        firstName,
        lastName,
        employeeId,
      };
      if (fillChanged) payload.fillStatus = fillStatus;
      if (bleachChanged) payload.bleachStatus = bleachStatus;
      writes.push(addDoc(collection(db, 'operationalStatusLogs'), payload));
    }

    if (!writes.length) {
      setOperationalMessage('No operational status changes to submit.');
      return;
    }

    await Promise.all(writes);
    await loadOperationalStatusLogs();
    renderOperationalStatusLog();
    if (allLogs.length && document.getElementById('supervisorDashboard')?.classList.contains('show')) {
      renderDashboard(allLogs);
    }
    setOperationalMessage('Operational status submitted successfully.');
  } catch (err) {
    console.error('[PoolPro] Unable to save operational status:', err);
    setOperationalMessage('Unable to submit operational status right now.', true);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = !getOperationalSelectedFacility();
      submitBtn.textContent = 'Submit Status';
    }
  }
}

function setupOperationalStatusLog() {
  const select = document.getElementById('operationalPoolLocation');
  const submitBtn = document.getElementById('operationalStatusSubmit');
  if (!select || !submitBtn || operationalStatusPageReady) return;
  operationalStatusPageReady = true;
  select.addEventListener('change', renderOperationalStatusLog);
  submitBtn.addEventListener('click', saveOperationalStatusLog);
  loadOperationalStatusLogs().then(renderOperationalStatusLog);
}

// ============================================================
// EMPLOYEE MANAGEMENT
// ============================================================

let employeesData = [];
let editingEmployeeIdx = -1;
let employeeMarketFilter = 'all';
let employeePoolFilter = 'all';
let employeePage = 1;
const EMPLOYEES_PER_PAGE = 10;

async function loadEmployees() {
  try {
    const ref = doc(db, 'settings', 'employees');
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      employeesData = Array.isArray(data.employees) ? data.employees.map(normalizeEmployeeRecord) : [];
    } else {
      employeesData = [];
    }
    renderEmployeesTable();
  } catch (err) {
    console.error('[ChemLog] Error loading employees:', err);
  }
}

async function saveEmployees() {
  try {
    employeesData = employeesData.map(normalizeEmployeeRecord);
    await setDoc(doc(db, 'settings', 'employees'), { employees: employeesData }, { merge: true });
    renderRolesPermissionsSettings();
  } catch (err) {
    console.error('[ChemLog] Error saving employees:', err);
  }
}

async function loadSecuritySettings() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'security'));
    if (snap.exists()) {
      const data = snap.data() || {};
      const savedTimeout = String(data.sessionTimeout || '360');
      const allowedTimeouts = new Set(Array.from({ length: 10 }, (_, i) => String((i + 1) * 60)));
      securitySettings = {
        sessionTimeout: allowedTimeouts.has(savedTimeout) ? savedTimeout : '360',
        requirePasswordConfirm: data.requirePasswordConfirm !== false,
      };
    } else {
      securitySettings = {
        sessionTimeout: '360',
        requirePasswordConfirm: true,
      };
    }
  } catch (err) {
    console.error('[ChemLog] Error loading security settings:', err);
  }
}

function clearSecurityIdleTimer() {
  if (securityIdleTimer) {
    clearTimeout(securityIdleTimer);
    securityIdleTimer = null;
  }
}

function applySecuritySessionTimeout() {
  clearSecurityIdleTimer();
  const timeoutMinutes = Number(securitySettings.sessionTimeout || 0);
  if (!isSupervisor() || !timeoutMinutes || Number.isNaN(timeoutMinutes)) return;

  const resetTimer = () => {
    clearSecurityIdleTimer();
    securityIdleTimer = setTimeout(() => {
      alert('You have been logged out due to inactivity.');
      if (typeof window.logout === 'function') window.logout();
    }, timeoutMinutes * 60 * 1000);
  };

  if (!securityEventsBound) {
    ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach((evt) => {
      window.addEventListener(evt, resetTimer, { passive: true });
    });
    securityEventsBound = true;
  }
  resetTimer();
}

function setupSecuritySettingsUI() {
  const timeoutSelect = document.getElementById('securityTimeoutSelect');
  const requirePassCb = document.getElementById('securityRequirePassword');
  let editBtn = document.getElementById('securityEditBtn');
  let saveBtn = document.getElementById('securitySaveBtn');
  if (!timeoutSelect || !requirePassCb || !saveBtn) return;

  // Apply the overlay only to the content wrapper (not the whole section with title/buttons)
  const contentWrap = document.querySelector('.security-content-wrap');
  if (!contentWrap) return;
  contentWrap.classList.add('sanitation-section', 'security-section');

  const securitySection = saveBtn.closest('.settings-section') || timeoutSelect.closest('.settings-section');
  if (securitySection) securitySection.id = 'securitySection';

  let controls = document.getElementById('securityControls');
  if (!controls) {
    const controlsRow = securitySection?.querySelector('.security-controls-row') || securitySection;
    const controlsWrap = document.createElement('div');
    controlsWrap.className = 'toggle-btn';
    controlsWrap.innerHTML = `
      <div id="securityControls" class="sanitation-controls">
        <div class="sanitation-controls-thumb"></div>
        <button type="button" class="editAndSave active" id="securityEditBtn">Edit</button>
      </div>
    `;
    controlsRow.appendChild(controlsWrap);
    controls = controlsWrap.querySelector('#securityControls');
    editBtn = controls.querySelector('#securityEditBtn');
    controls.appendChild(saveBtn);
  } else if (!editBtn) {
    editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'editAndSave active';
    editBtn.id = 'securityEditBtn';
    editBtn.textContent = 'Edit';
    controls.appendChild(editBtn);
  }

  saveBtn.classList.remove('submit-btn');
  saveBtn.classList.add('editAndSave');
  saveBtn.style.marginTop = '';

  const timeoutOptions = Array.from({ length: 10 }, (_, i) => {
    const hours = i + 1;
    return { value: String(hours * 60), label: `${hours} hour${hours === 1 ? '' : 's'}` };
  });
  timeoutSelect.innerHTML = '';
  timeoutOptions.forEach(({ value, label }) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    timeoutSelect.appendChild(opt);
  });
  requirePassCb.classList.add('market-filter-checkbox');
  requirePassCb.style.marginRight = '10px';

  timeoutSelect.value = timeoutOptions.some((option) => option.value === securitySettings.sessionTimeout)
    ? securitySettings.sessionTimeout
    : '360';
  requirePassCb.checked = securitySettings.requirePasswordConfirm !== false;

  const setEditable = (editable) => {
    contentWrap.classList.toggle('overlay-disabled', !editable);
    timeoutSelect.disabled = !editable;
    requirePassCb.disabled = !editable;
    editBtn.classList.toggle('active', editable);
    saveBtn.classList.toggle('active', !editable);
    editBtn.disabled = editable;
    saveBtn.disabled = !editable;
    const thumb = document.querySelector('#securityControls .sanitation-controls-thumb');
    if (thumb) thumb.style.transform = editable ? 'translateX(0%)' : 'translateX(100%)';
  };

  setEditable(false);

  if (!editBtn || !saveBtn || controls?.dataset.securityBound === 'true') return;
  controls.dataset.securityBound = 'true';

  editBtn.addEventListener('click', () => setEditable(true));

  saveBtn.addEventListener('click', async () => {
    securitySettings = {
      sessionTimeout: timeoutSelect.value || 'never',
      requirePasswordConfirm: !!requirePassCb.checked,
    };
    try {
      await setDoc(doc(db, 'settings', 'security'), securitySettings, { merge: true });
      applySecuritySessionTimeout();
      setEditable(false);
    } catch (err) {
      console.error('[ChemLog] Error saving security settings:', err);
      alert('Unable to save security settings.');
    }
  });
}

function formatPhoneDisplay(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 10) return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === '1') return `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
  return raw || '';
}

function getTenDigitPhone(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length >= 10) return digits.slice(-10);
  return '';
}

function normalizePhoneDigits(raw) {
  return (raw || '').replace(/\D/g, '');
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
    username: (employee.username ?? '').toString().trim().toLowerCase(),
    firstName: (employee.firstName ?? '').toString().trim(),
    lastName: (employee.lastName ?? '').toString().trim(),
    homePool: (employee.homePool ?? '').toString().trim(),
    phone: normalizePhoneDigits(employee.phone ?? ''),
  };
}

function renderEmployeesTable() {
  const tbody = document.getElementById('employeesTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  // Determine which employees to show based on active filters
  let filteredEmployees = employeesData.map((emp, index) => ({ emp, index }));
  if (employeePoolFilter !== 'all') {
    filteredEmployees = filteredEmployees.filter(({ emp }) => emp.homePool === employeePoolFilter);
  } else if (employeeMarketFilter !== 'all') {
    const marketPoolNames = poolsCache
      .filter(p => {
        const markets = Array.isArray(p.markets) ? p.markets : (p.market ? [p.market] : []);
        return markets.includes(employeeMarketFilter);
      })
      .map(p => p.name || p.id);
    filteredEmployees = filteredEmployees.filter(({ emp }) => marketPoolNames.includes(emp.homePool));
  }
  filteredEmployees.sort((a, b) => {
    const aLast = String(a.emp.lastName || '').toLowerCase();
    const bLast = String(b.emp.lastName || '').toLowerCase();
    if (aLast !== bLast) return aLast.localeCompare(bLast);
    const aFirst = String(a.emp.firstName || '').toLowerCase();
    const bFirst = String(b.emp.firstName || '').toLowerCase();
    if (aFirst !== bFirst) return aFirst.localeCompare(bFirst);
    return String(a.emp.email || a.emp.id || '').localeCompare(String(b.emp.email || b.emp.id || ''));
  });

  // Pagination: show 10 rows per page
  const totalPages = Math.max(1, Math.ceil(filteredEmployees.length / EMPLOYEES_PER_PAGE));
  if (employeePage > totalPages) employeePage = totalPages;
  const pageStart = (employeePage - 1) * EMPLOYEES_PER_PAGE;
  const pageEmployees = filteredEmployees.slice(pageStart, pageStart + EMPLOYEES_PER_PAGE);

  pageEmployees.forEach(({ emp, index: sourceIndex }) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${emp.firstName || ''}</td>
      <td>${emp.lastName || ''}</td>
      <td>${emp.email || emp.id || ''}</td>
      <td>${formatPhoneDisplay(emp.phone)}</td>
      <td>${emp.homePool || ''}</td>
      <td class="actions-cell"></td>
    `;
    const actionsCell = tr.querySelector('.actions-cell');

    actionsCell.style.cssText = 'text-align:center;vertical-align:middle;padding:4px 6px;';
    const btnWrap = document.createElement('div');
    btnWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = 'Edit';
    editBtn.className = 'submit-btn';
    editBtn.style.cssText = 'padding:3px 10px;font-size:0.82rem;width:70px;';
    editBtn.addEventListener('click', () => {
      editingEmployeeIdx = sourceIndex;
      document.getElementById('employeeIdInput').value = emp.email || emp.id || '';
      document.getElementById('employeeFirstNameInput').value = emp.firstName || '';
      document.getElementById('employeeLastNameInput').value = emp.lastName || '';
      const homePoolSel = document.getElementById('employeeHomePoolInput');
      if (homePoolSel) homePoolSel.value = emp.homePool || '';
      document.getElementById('employeePhoneInput').value = emp.phone || '';
      const addBtn = document.getElementById('employeeAddBtn');
      if (addBtn) addBtn.textContent = 'Save';
      // Remove overlay so form and table are editable
      const section = document.getElementById('employeeTableSection');
      if (section) section.classList.remove('overlay-disabled');
      const eBtn = document.getElementById('employeeEditBtn');
      const sBtn = document.getElementById('employeeSaveBtn');
      if (eBtn) { eBtn.classList.remove('active'); eBtn.disabled = true; }
      if (sBtn) { sBtn.classList.add('active'); sBtn.disabled = false; }
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = 'Remove';
    removeBtn.className = 'submit-btn';
    removeBtn.style.cssText = 'padding:3px 10px;font-size:0.82rem;width:70px;';
    removeBtn.addEventListener('click', async () => {
      if (!confirm(`Remove ${emp.firstName || ''} ${emp.lastName || ''} (${emp.email || emp.id || ''})?`)) return;
      const idxToRemove = sourceIndex;
      if (idxToRemove < 0 || idxToRemove >= employeesData.length) return;
      employeesData.splice(idxToRemove, 1);
      await saveEmployees();
      renderEmployeesTable();
    });

    btnWrap.appendChild(editBtn);
    btnWrap.appendChild(removeBtn);
    actionsCell.appendChild(btnWrap);
    tbody.appendChild(tr);
  });

  renderEmployeePagination(totalPages);
}

function renderEmployeePagination(totalPages) {
  // Remove existing pagination
  document.getElementById('employeePagination')?.remove();
  const tableSection = document.getElementById('employeeTableSection');
  if (!tableSection || totalPages <= 1) return;

  const container = document.createElement('div');
  container.id = 'employeePagination';
  container.className = 'emp-pagination-row';

  const backBtn = document.createElement('button');
  backBtn.className = 'emp-pagination-arrow';
  backBtn.textContent = '←';
  if (employeePage > 1) {
    backBtn.addEventListener('click', () => { employeePage--; renderEmployeesTable(); });
  } else {
    backBtn.style.visibility = 'hidden';
    backBtn.disabled = true;
  }
  container.appendChild(backBtn);

  const sel = document.createElement('select');
  sel.className = 'training-filter-select emp-pagination-select';
  for (let p = 1; p <= totalPages; p++) {
    const opt = document.createElement('option');
    opt.value = String(p);
    opt.textContent = `Page ${p}`;
    if (p === employeePage) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => { employeePage = Number(sel.value); renderEmployeesTable(); });
  container.appendChild(sel);

  const fwdBtn = document.createElement('button');
  fwdBtn.className = 'emp-pagination-arrow';
  fwdBtn.textContent = '→';
  if (employeePage < totalPages) {
    fwdBtn.addEventListener('click', () => { employeePage++; renderEmployeesTable(); });
  } else {
    fwdBtn.style.visibility = 'hidden';
    fwdBtn.disabled = true;
  }
  container.appendChild(fwdBtn);

  tableSection.insertAdjacentElement('afterend', container);
}

function setupEmployeeManagement() {
  // Add single employee
  const addBtn = document.getElementById('employeeAddBtn');
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      const email = (document.getElementById('employeeIdInput')?.value.trim() || '').toLowerCase();
      const firstName = document.getElementById('employeeFirstNameInput')?.value.trim() || '';
      const lastName = document.getElementById('employeeLastNameInput')?.value.trim();
      const homePool = document.getElementById('employeeHomePoolInput')?.value || '';
      const phone = normalizePhoneDigits(document.getElementById('employeePhoneInput')?.value);
      if (!email || !email.includes('@') || !firstName || !lastName || !homePool) {
        alert('Preferred First Name, Last Name, Email, and Home Pool are required.');
        return;
      }
      const wasEditing = editingEmployeeIdx >= 0;
      const nextEmployee = normalizeEmployeeRecord({
        ...(wasEditing ? employeesData[editingEmployeeIdx] : {}),
        email,
        id: email,
        firstName,
        lastName,
        homePool,
        phone
      });
      if (wasEditing) {
        employeesData[editingEmployeeIdx] = nextEmployee;
        editingEmployeeIdx = -1;
      } else {
        employeesData.push(nextEmployee);
      }
      addBtn.textContent = 'Add';
      await saveEmployees();
      renderEmployeesTable();
      // Re-apply overlay after save (whether adding or editing)
      const empSection = document.getElementById('employeeTableSection');
      if (empSection) empSection.classList.add('overlay-disabled');
      const eBtn2 = document.getElementById('employeeEditBtn');
      const sBtn2 = document.getElementById('employeeSaveBtn');
      if (eBtn2) { eBtn2.classList.add('active'); eBtn2.disabled = false; }
      if (sBtn2) { sBtn2.classList.remove('active'); sBtn2.disabled = true; }
      ['employeeIdInput', 'employeeFirstNameInput', 'employeeLastNameInput', 'employeePhoneInput'].forEach(fid => {
        const el = document.getElementById(fid);
        if (el) el.value = '';
      });
      const homePoolSelClear = document.getElementById('employeeHomePoolInput');
      if (homePoolSelClear) homePoolSelClear.value = '';
    });
  }

  // Import from Excel/CSV — auto-import on file selection
  const fileInput = document.getElementById('employeeFileInput');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const XLSX = window.XLSX;
          if (!XLSX) { alert('XLSX library not loaded.'); return; }
          const wb = XLSX.read(evt.target.result, { type: 'binary' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
          const newEmps = rows
            .map((row) => {
              const data = Object.fromEntries(
                Object.entries(row).map(([key, value]) => [String(key || '').trim().toLowerCase(), value])
              );
              const email = String(
                data.email ||
                data['email address'] ||
                data['employee email'] ||
                ''
              ).trim().toLowerCase();
              const firstName = String(
                data['preferred first name'] ||
                data['first name'] ||
                data.firstname ||
                ''
              ).trim();
              const lastName = String(data['last name'] || data.lastname || '').trim();
              const phone = String(data['phone number'] || data.phone || '').trim();
              const homePool = String(
                data['home pool'] ||
                data['home facility'] ||
                data.facility ||
                ''
              ).trim();
              if (!email) return null;
              return normalizeEmployeeRecord({
                email,
                id: email,
                firstName,
                lastName,
                phone,
                homePool
              });
            })
            .filter(Boolean);
          employeesData = [...employeesData, ...newEmps];
          await saveEmployees();
          renderEmployeesTable();
          alert(`Imported ${newEmps.length} employee(s).`);
        } catch (err) {
          console.error('[ChemLog] Import error:', err);
          alert('Failed to import. Use Excel (.xlsx) or CSV format.');
        }
        fileInput.value = '';
      };
      reader.readAsBinaryString(file);
    });
  }
}

function setupDeleteAllEmployees() {
  const deleteAllBtn = document.getElementById('employeeDeleteAllBtn');
  if (!deleteAllBtn) return;
  const fileRow = document.querySelector('.employee-file-row');
  if (fileRow && deleteAllBtn.parentElement !== fileRow) {
    deleteAllBtn.classList.add('employee-delete-inline-btn');
    fileRow.appendChild(deleteAllBtn);
  }

  deleteAllBtn.addEventListener('click', async () => {
    if (!auth.currentUser) {
      alert('You must be logged in to perform this action.');
      return;
    }
    if (!confirm('Delete ALL employees? This cannot be undone.')) return;

    if (securitySettings.requirePasswordConfirm !== false) {
      const password = prompt('Enter your password to confirm:');
      if (!password) return;

      try {
        const credential = EmailAuthProvider.credential(auth.currentUser.email, password);
        await reauthenticateWithCredential(auth.currentUser, credential);
      } catch (err) {
        alert('Incorrect password. Deletion cancelled.');
        return;
      }
    }

    employeesData = [];
    await saveEmployees();
    renderEmployeesTable();
  });
}

function populateEmployeePoolFilter(market) {
  const poolFilter = document.getElementById('employeePoolFilter');
  if (!poolFilter) return;
  const current = poolFilter.value;
  poolFilter.innerHTML = '<option value="all">Home Pool</option>';
  let pools = market === 'all' ? poolsCache : poolsCache.filter(p => {
    const markets = Array.isArray(p.markets) ? p.markets : (p.market ? [p.market] : []);
    return markets.includes(market);
  });
  pools.sort((a, b) => (a.name || '').localeCompare(b.name || '')).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.name || p.id;
    opt.textContent = p.name || p.id;
    poolFilter.appendChild(opt);
  });
  if (current && current !== 'all') poolFilter.value = current;
}

function setupEmployeeFilters() {
  const marketFilter = document.getElementById('employeeMarketFilter');
  const poolFilter = document.getElementById('employeePoolFilter');
  if (!marketFilter || !poolFilter) return;

  // Populate pool filter options initially with all pools
  populateEmployeePoolFilter('all');

  marketFilter.addEventListener('change', () => {
    employeeMarketFilter = marketFilter.value;
    employeePoolFilter = 'all';
    employeePage = 1;
    poolFilter.value = 'all';
    populateEmployeePoolFilter(marketFilter.value);
    renderEmployeesTable();
  });

  poolFilter.addEventListener('change', () => {
    employeePoolFilter = poolFilter.value;
    employeePage = 1;
    renderEmployeesTable();
  });
}

// ============================================================
// ROLES AND PERMISSIONS
// ============================================================

function employeeDisplayName(employee) {
  const normalized = normalizeEmployeeRecord(employee || {});
  const name = [normalized.firstName, normalized.lastName].filter(Boolean).join(' ').trim();
  return name || normalized.email || normalized.username || normalized.id || 'Unnamed employee';
}

function findEmployeeByRoleKey(roleKey) {
  const key = normalizeIdentityKey(roleKey);
  return employeesData.find((employee) => getEmployeeRoleKey(employee) === key) || null;
}

function ensureRolesPermissionsSettingsSection() {
  if (document.getElementById('rolesPermissionsSettings')) {
    renderRolesPermissionsSettings();
    return;
  }
  const employeeSection = document.getElementById('employeeSettings');
  if (!employeeSection) return;

  const section = document.createElement('section');
  section.className = 'settings-section settings-group roles-permissions-section';
  section.id = 'rolesPermissionsSettings';
  section.innerHTML = `
    <h3>Roles and Permissions</h3>
    <p class="section-subtitle">Assign limited site access to existing employees.</p>
    <div class="roles-add-row">
      <div class="settings-field">
        <label for="roleAssignmentSelect">Role</label>
        <select id="roleAssignmentSelect">
          <option value="poolManager">Pool Manager</option>
          <option value="supervisor">Supervisor</option>
        </select>
      </div>
      <div class="settings-field roles-search-field">
        <label for="roleEmployeeSearch">Employee</label>
        <input type="text" id="roleEmployeeSearch" autocomplete="off" placeholder="Type a name, email, or username">
        <div class="roles-search-results" id="roleEmployeeSearchResults"></div>
      </div>
    </div>
    <div class="roles-tables-grid">
      <div>
        <h4>Pool Managers</h4>
        <div class="table-scroll-wrap">
          <table class="employee-table roles-table">
            <thead><tr><th>Name</th><th>Email</th><th>Permissions</th><th>Remove</th></tr></thead>
            <tbody id="poolManagerRoleBody"></tbody>
          </table>
        </div>
      </div>
      <div>
        <h4>Supervisors</h4>
        <div class="table-scroll-wrap">
          <table class="employee-table roles-table">
            <thead><tr><th>Name</th><th>Email</th><th>Permissions</th><th>Remove</th></tr></thead>
            <tbody id="supervisorRoleBody"></tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="permissions-table-wrap">
      <h4>Permissions</h4>
      <div class="table-scroll-wrap">
        <table class="employee-table roles-permissions-table">
          <thead><tr><th>Role</th><th>Pool Chemistry Dashboard</th><th>Managerial Report</th></tr></thead>
          <tbody id="rolePermissionsBody"></tbody>
        </table>
      </div>
    </div>
  `;
  employeeSection.insertAdjacentElement('afterend', section);
  setupRolesPermissionsSearch();
  renderRolesPermissionsSettings();
}

function setupRolesPermissionsSearch() {
  const input = document.getElementById('roleEmployeeSearch');
  const results = document.getElementById('roleEmployeeSearchResults');
  const roleSelect = document.getElementById('roleAssignmentSelect');
  if (!input || !results || !roleSelect || input.dataset.bound === 'true') return;
  input.dataset.bound = 'true';

  const renderResults = () => {
    const term = normalizeIdentityKey(input.value);
    results.innerHTML = '';
    if (!term) {
      results.classList.remove('visible');
      return;
    }
    const matches = employeesData
      .filter((employee) => {
        const normalized = normalizeEmployeeRecord(employee);
        const haystack = [
          employeeDisplayName(normalized),
          normalized.email,
          normalized.username,
          normalized.id,
          normalized.homePool,
        ].join(' ').toLowerCase();
        return haystack.includes(term);
      })
      .slice(0, 8);
    matches.forEach((employee) => {
      const normalized = normalizeEmployeeRecord(employee);
      const key = getEmployeeRoleKey(normalized);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'roles-search-option';
      button.textContent = `${employeeDisplayName(normalized)}${normalized.email ? ` — ${normalized.email}` : ''}`;
      button.addEventListener('click', async () => {
        const role = roleSelect.value || 'poolManager';
        if (!rolesPermissionsData.roles[role]) rolesPermissionsData.roles[role] = [];
        if (!rolesPermissionsData.roles[role].includes(key)) {
          rolesPermissionsData.roles[role].push(key);
          await saveRolesPermissions();
          renderRolesPermissionsSettings();
        }
        input.value = '';
        results.innerHTML = '';
        results.classList.remove('visible');
      });
      results.appendChild(button);
    });
    results.classList.toggle('visible', matches.length > 0);
  };

  input.addEventListener('input', renderResults);
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.roles-search-field')) results.classList.remove('visible');
  });
}

function renderRoleMembers(roleKey, tbodyId) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = '';
  const members = rolesPermissionsData.roles[roleKey] || [];
  if (!members.length) {
    tbody.innerHTML = '<tr><td colspan="4">No users assigned.</td></tr>';
    return;
  }
  members.forEach((memberKey) => {
    const employee = findEmployeeByRoleKey(memberKey);
    const displayName = employee ? employeeDisplayName(employee) : memberKey;
    const email = normalizeEmployeeRecord(employee || { email: memberKey }).email || memberKey;
    const individual = rolesPermissionsData.individualPermissions[memberKey] || {};
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(displayName)}</td>
      <td>${escapeHtml(email)}</td>
      <td class="roles-row-permissions"></td>
      <td class="actions-cell"></td>
    `;
    const permissionsCell = tr.querySelector('.roles-row-permissions');
    const permissionsButton = document.createElement('button');
    permissionsButton.type = 'button';
    permissionsButton.className = 'submit-btn roles-permissions-btn';
    permissionsButton.textContent = 'Permissions';
    const permissionsPanel = document.createElement('div');
    permissionsPanel.className = 'roles-individual-permissions hidden';
    permissionsButton.addEventListener('click', () => {
      permissionsPanel.classList.toggle('hidden');
    });
    permissionsCell.appendChild(permissionsButton);
    permissionsCell.appendChild(permissionsPanel);
    PERMISSION_DEFINITIONS.forEach(({ key, label }) => {
      const labelEl = document.createElement('label');
      labelEl.className = 'roles-inline-check';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'market-filter-checkbox';
      checkbox.checked = !!individual[key];
      checkbox.addEventListener('change', async () => {
        if (!rolesPermissionsData.individualPermissions[memberKey]) {
          rolesPermissionsData.individualPermissions[memberKey] = {};
        }
        rolesPermissionsData.individualPermissions[memberKey][key] = checkbox.checked;
        await saveRolesPermissions();
      });
      labelEl.appendChild(checkbox);
      labelEl.appendChild(document.createTextNode(label));
      permissionsPanel.appendChild(labelEl);
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'submit-btn roles-remove-btn';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', async () => {
      rolesPermissionsData.roles[roleKey] = (rolesPermissionsData.roles[roleKey] || []).filter((key) => key !== memberKey);
      await saveRolesPermissions();
      renderRolesPermissionsSettings();
    });
    tr.querySelector('.actions-cell').appendChild(removeBtn);
    tbody.appendChild(tr);
  });
}

function renderRolePermissionsTable() {
  const tbody = document.getElementById('rolePermissionsBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  ROLE_DEFINITIONS.forEach(({ key: roleKey, label }) => {
    const tr = document.createElement('tr');
    const roleTd = document.createElement('td');
    roleTd.textContent = label;
    tr.appendChild(roleTd);
    PERMISSION_DEFINITIONS.forEach(({ key: permissionKey }) => {
      const td = document.createElement('td');
      td.style.textAlign = 'center';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'market-filter-checkbox';
      checkbox.checked = !!rolesPermissionsData.permissions[roleKey]?.[permissionKey];
      checkbox.addEventListener('change', async () => {
        if (!rolesPermissionsData.permissions[roleKey]) rolesPermissionsData.permissions[roleKey] = {};
        rolesPermissionsData.permissions[roleKey][permissionKey] = checkbox.checked;
        await saveRolesPermissions();
      });
      td.appendChild(checkbox);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function renderRolesPermissionsSettings() {
  const section = document.getElementById('rolesPermissionsSettings');
  if (!section) return;
  section.style.display = isDeveloperUser() ? '' : 'none';
  if (!isDeveloperUser()) return;
  renderRoleMembers('poolManager', 'poolManagerRoleBody');
  renderRoleMembers('supervisor', 'supervisorRoleBody');
  renderRolePermissionsTable();
}

// ============================================================
// RESOURCES
// ============================================================

let resourcesData = [];
let resourceEditingId = '';
let pendingResourceFile = null;
let resourceSourceType = 'file';
let resourcePageMarketFilter = 'all';
let resourcePagePoolFilter = 'all';
let resourceSettingsMarketFilter = 'all';
let resourceSettingsPoolFilter = 'all';
const resourceDataUrlMap = new Map();
const RESOURCE_FILTER_ALL_VALUE = 'all';
const RESOURCE_ALL_FACILITIES_VALUE = 'All';
const FIRESTORE_RESOURCE_STORAGE = 'firestoreChunks';
const RESOURCE_FIRESTORE_CHUNK_SIZE = 650000;
const RESOURCE_FIRESTORE_MAX_FILE_SIZE = 20 * 1024 * 1024;
const RESOURCE_STORAGE_UPLOAD_TIMEOUT_MS = 12000;
const RESOURCE_STORAGE_URL_TIMEOUT_MS = 10000;
const RESOURCE_STORAGE_BLOCKED_SESSION_KEY = 'poolproResourceStorageBlocked';

function getResourceStorage() {
  return getStorage(getApp());
}

function ensureResourcesSettingsSection() {
  if (document.getElementById('resourceSettings')) return;
  const employeeSettings = document.getElementById('employeeSettings');
  if (!employeeSettings) return;

  const section = document.createElement('section');
  section.className = 'settings-section settings-group';
  section.id = 'resourceSettings';
  section.innerHTML = `
    <h3>Resources</h3>
    <div class="resource-section-header">
      <button type="button" id="resourceDeleteAllBtn" class="submit-btn danger-button resource-delete-all-btn">Delete All Resources</button>
    </div>
    <p class="section-subtitle">Upload and manage the documents, videos, and website links available on the Resources page.</p>
    <div class="settings-row resource-type-row" style="margin-top: 20px;">
      <label for="resourceSourceTypeSelect" class="settings-field-label">Resource Type</label>
      <select id="resourceSourceTypeSelect" class="training-filter-select" aria-label="Resource type">
        <option value="file">File Upload</option>
        <option value="link">Website Link</option>
      </select>
    </div>
    <div class="settings-row resource-file-row" style="margin-top: 20px;">
      <label for="resourceFileInput" class="settings-field-label" id="resourceFileLabel">Resource File</label>
      <input type="file" id="resourceFileInput" aria-label="Resource file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.ppt,.pptx,.jpg,.jpeg,.png,.mp4,.mov,.webm,.avi,.mkv,.m4v" />
      <input type="url" id="resourceLinkInput" class="resource-link-input hidden" aria-label="Resource link" placeholder="https://example.com/resource" />
    </div>
    <div class="settings-row resource-add-row">
      <div class="settings-field">
        <label for="resourceDocumentNameInput">Document Name</label>
        <input type="text" id="resourceDocumentNameInput" />
      </div>
      <div class="settings-field">
        <label for="resourceDescriptionInput">Description</label>
        <input type="text" id="resourceDescriptionInput" />
      </div>
      <div class="settings-field">
        <label for="resourcePoolInput">Facility</label>
        <select id="resourcePoolInput">
          <option value="">Select facility</option>
        </select>
      </div>
    </div>
    <div class="employee-add-btn-row">
      <button type="button" class="submit-btn button-shadow employee-action-btn" id="resourceAddBtn">Add</button>
    </div>
    <div class="training-filter-bar employee-filter-bar" id="resourceFilterBar" style="margin: 20px 0 4px;">
      <span class="filter-by-label">Filter By:</span>
      <select id="resourceMarketFilter" class="training-filter-select" aria-label="Filter resources by market">
        <option value="all">All Markets</option>
      </select>
      <select id="resourcePoolFilter" class="training-filter-select" aria-label="Filter resources by facility">
        <option value="all">All</option>
      </select>
    </div>
    <div id="resourceTableSection" class="sanitation-section overlay-disabled resource-table-section">
      <div class="table-scroll-shell resource-table-scroll-shell">
        <div class="table-scroll-wrap resource-table-scroll-wrap">
          <table class="employee-table resource-table resource-table-admin">
            <thead>
              <tr>
                <th>Document Name</th>
                <th>Upload Date</th>
                <th>Description</th>
                <th>Market</th>
                <th>Facility</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="resourceTableBody"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;
  employeeSettings.insertAdjacentElement('afterend', section);
  wrapResponsiveTables(section);
}

function getPoolMarket(poolName) {
  if (isResourceAllFacilities(poolName)) return RESOURCE_ALL_FACILITIES_VALUE;
  const match = poolsCache.find((pool) => getPoolName(pool) === poolName);
  if (!match) return '';
  const markets = Array.isArray(match.markets) ? match.markets : (match.market ? [match.market] : []);
  return markets[0] || '';
}

function getResourceMarket(item) {
  if (isResourceAllFacilities(item?.pool)) return RESOURCE_ALL_FACILITIES_VALUE;
  return (item?.market || getPoolMarket(item?.pool || '') || '').toString().trim();
}

function isResourceAllFacilities(value) {
  const normalized = (value || '').toString().trim().toLowerCase();
  return normalized === 'all' || normalized === 'all facilities';
}

function normalizeResourcePoolValue(value) {
  const trimmed = (value || '').toString().trim();
  return isResourceAllFacilities(trimmed) ? RESOURCE_ALL_FACILITIES_VALUE : trimmed;
}

function getAllMarkets() {
  return Array.from(new Set(
    poolsCache
      .flatMap((pool) => {
        const markets = Array.isArray(pool.markets) ? pool.markets : (pool.market ? [pool.market] : []);
        return markets.length ? markets : ['Other'];
      })
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b));
}

function normalizeResourceRecord(rawDoc, idOverride = '') {
  const docData = rawDoc || {};
  const uploadDate = (docData.uploadDate || '').toString().trim();
  const parsedDate = uploadDate ? new Date(`${uploadDate}T00:00:00`) : null;
  const fallbackDate = docData.uploadedAt?.toDate ? docData.uploadedAt.toDate() : null;
  const sortDate = Number.isFinite(docData.sortDate)
    ? docData.sortDate
    : parsedDate && !Number.isNaN(parsedDate.getTime())
      ? parsedDate.getTime()
      : fallbackDate
        ? fallbackDate.getTime()
        : 0;

  return {
    id: idOverride || docData.id || '',
    documentName: (docData.documentName || '').toString().trim(),
    uploadDate,
    description: (docData.description || '').toString().trim(),
    market: (docData.market || '').toString().trim(),
    pool: normalizeResourcePoolValue(docData.pool),
    fileUrl: (docData.fileUrl || '').toString().trim(),
    fileName: (docData.fileName || '').toString().trim(),
    storagePath: (docData.storagePath || '').toString().trim(),
    storageType: (docData.storageType || '').toString().trim(),
    contentType: (docData.contentType || '').toString().trim(),
    fileSize: Number(docData.fileSize || 0),
    chunkCount: Number(docData.chunkCount || 0),
    dataUrlPrefix: (docData.dataUrlPrefix || '').toString().trim(),
    resourceType: (docData.resourceType || docData.type || '').toString().trim() || 'file',
    sortDate,
    uploadedAt: docData.uploadedAt || null,
  };
}

function sortResourcesDescending(a, b) {
  if (b.sortDate !== a.sortDate) return b.sortDate - a.sortDate;
  return (a.documentName || '').localeCompare(b.documentName || '');
}

function formatResourceDate(uploadDate, uploadedAt) {
  if (uploadDate) {
    const parsed = new Date(`${uploadDate}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleDateString();
  }
  const fallback = uploadedAt?.toDate ? uploadedAt.toDate() : null;
  return fallback ? fallback.toLocaleDateString() : '—';
}

function getFilteredResources({ market = 'all', pool = 'all' } = {}) {
  return resourcesData
    .filter((item) => (market === RESOURCE_FILTER_ALL_VALUE ? true : getResourceMarket(item) === market || isResourceAllFacilities(item.pool)))
    .filter((item) => (pool === RESOURCE_FILTER_ALL_VALUE ? true : item.pool === pool || isResourceAllFacilities(item.pool)))
    .sort(sortResourcesDescending);
}

function populateResourcePoolOptions(selectEl, market = 'all', includeAll = false) {
  if (!selectEl) return;
  const current = selectEl.value;
  const defaultValue = includeAll ? RESOURCE_FILTER_ALL_VALUE : '';
  const defaultLabel = includeAll ? 'All' : 'Select facility';
  selectEl.innerHTML = `<option value="${defaultValue}">${defaultLabel}</option>`;

  if (!includeAll) {
    const allOption = document.createElement('option');
    allOption.value = RESOURCE_ALL_FACILITIES_VALUE;
    allOption.textContent = RESOURCE_ALL_FACILITIES_VALUE;
    selectEl.appendChild(allOption);
  }

  const pools = (market === 'all' || !market)
    ? [...poolsCache]
    : poolsCache.filter((pool) => {
      const markets = Array.isArray(pool.markets) ? pool.markets : (pool.market ? [pool.market] : []);
      return markets.includes(market);
    });

  const groups = {};
  pools.forEach((pool) => {
    const poolName = getPoolName(pool);
    if (!poolName) return;
    const markets = Array.isArray(pool.markets) ? pool.markets : (pool.market ? [pool.market] : []);
    const groupName = markets[0] || 'Other';
    if (!groups[groupName]) groups[groupName] = [];
    groups[groupName].push(poolName);
  });

  Object.keys(groups).sort((a, b) => a.localeCompare(b)).forEach((marketName) => {
    const group = document.createElement('optgroup');
    group.label = marketName;
    groups[marketName]
      .sort((a, b) => a.localeCompare(b))
      .forEach((poolName) => {
        const option = document.createElement('option');
        option.value = poolName;
        option.textContent = poolName;
        group.appendChild(option);
      });
    selectEl.appendChild(group);
  });

  if (current && Array.from(selectEl.options).some((option) => option.value === current)) {
    selectEl.value = current;
  }
}

function populateResourceMarketOptions(selectEl, includeAll = false) {
  if (!selectEl) return;
  const current = selectEl.value;
  const label = includeAll ? 'All Markets' : 'Select market';
  selectEl.innerHTML = `<option value="${includeAll ? 'all' : ''}">${label}</option>`;
  getAllMarkets().forEach((market) => {
    const option = document.createElement('option');
    option.value = market;
    option.textContent = market;
    selectEl.appendChild(option);
  });
  if (current && Array.from(selectEl.options).some((option) => option.value === current)) {
    selectEl.value = current;
  }
}

function refreshResourceControls() {
  populateResourceMarketOptions(document.getElementById('resourceMarketFilter'), true);
  populateResourceMarketOptions(document.getElementById('resourcesMarketFilter'), true);

  populateResourcePoolOptions(document.getElementById('resourcePoolInput'), 'all', false);
  populateResourcePoolOptions(document.getElementById('resourcePoolFilter'), document.getElementById('resourceMarketFilter')?.value || 'all', true);
  populateResourcePoolOptions(document.getElementById('resourcesPoolFilter'), document.getElementById('resourcesMarketFilter')?.value || 'all', true);
}

function normalizeResourceLink(rawValue) {
  const value = (rawValue || '').trim();
  if (!value) return '';
  try {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(withProtocol);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString();
  } catch (_) {
    return '';
  }
}

function setResourceSourceType(type) {
  resourceSourceType = type === 'link' ? 'link' : 'file';
  const sourceSelect = document.getElementById('resourceSourceTypeSelect');
  const fileInput = document.getElementById('resourceFileInput');
  const linkInput = document.getElementById('resourceLinkInput');
  const fileLabel = document.getElementById('resourceFileLabel');

  if (sourceSelect) sourceSelect.value = resourceSourceType;
  if (fileLabel) fileLabel.textContent = resourceSourceType === 'link' ? 'Resource Link' : 'Resource File';
  fileInput?.classList.toggle('hidden', resourceSourceType === 'link');
  linkInput?.classList.toggle('hidden', resourceSourceType !== 'link');
  if (resourceSourceType === 'link') {
    pendingResourceFile = null;
    if (fileInput) fileInput.value = '';
  } else if (linkInput) {
    linkInput.value = '';
  }
}

function isVideoUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (lower.startsWith('data:video/')) return true;
  return /\.(mp4|mov|webm|avi|mkv|m4v)(\?|$)/i.test(lower);
}

function buildResourceRowCells(item, includeActions = false) {
  const nameText = item.documentName || item.fileName || 'Untitled document';
  let nameHtml;
  if (item.fileUrl) {
    if (item.fileUrl.startsWith('data:')) {
      resourceDataUrlMap.set(item.id, item.fileUrl);
      nameHtml = `<a href="#" class="resource-doc-link" data-resource-key="${item.id}" rel="noopener">${nameText}</a>`;
    } else if (item.storageType === FIRESTORE_RESOURCE_STORAGE || item.fileUrl.startsWith(`${FIRESTORE_RESOURCE_STORAGE}:`)) {
      resourceDataUrlMap.set(item.id, item.fileUrl);
      nameHtml = `<a href="#" class="resource-doc-link" data-resource-key="${item.id}" rel="noopener">${nameText}</a>`;
    } else {
      nameHtml = `<a href="${item.fileUrl}" target="_blank" rel="noopener">${nameText}</a>`;
    }
  } else {
    nameHtml = nameText;
  }

  if (!includeActions) {
    return `
      <td>${nameHtml}</td>
      <td>${item.pool || '—'}</td>
      <td>${item.description || '—'}</td>
      <td>${formatResourceDate(item.uploadDate, item.uploadedAt)}</td>
    `;
  }

  return `
    <td>${nameHtml}</td>
    <td>${formatResourceDate(item.uploadDate, item.uploadedAt)}</td>
    <td>${item.description || '—'}</td>
    <td>${getResourceMarket(item) || '—'}</td>
    <td>${item.pool || '—'}</td>
    <td class="actions-cell"></td>
  `;
}

function renderResourcesPageTable() {
  const tbody = document.getElementById('resourcesTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const rows = getFilteredResources({
    market: resourcePageMarketFilter,
    pool: resourcePagePoolFilter,
  });

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;font-style:italic;">No resources found.</td></tr>';
    return;
  }

  rows.forEach((item) => {
    const tr = document.createElement('tr');
    tr.innerHTML = buildResourceRowCells(item, false);
    tbody.appendChild(tr);
  });
}

function renderResourcesSettingsTable() {
  const tbody = document.getElementById('resourceTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const rows = getFilteredResources({
    market: resourceSettingsMarketFilter,
    pool: resourceSettingsPoolFilter,
  });

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;font-style:italic;">No resources found.</td></tr>';
    const wrapper = tbody.closest('.table-scroll-wrap');
    if (wrapper) requestAnimationFrame(() => updateTableScrollShadow(wrapper));
    return;
  }

  rows.forEach((item) => {
    const tr = document.createElement('tr');
    tr.innerHTML = buildResourceRowCells(item, true);
    const actionsCell = tr.querySelector('.actions-cell');
    actionsCell.style.cssText = 'text-align:center;vertical-align:middle;padding:4px 6px;';

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = 'Edit';
    editBtn.className = 'submit-btn';
    editBtn.style.cssText = 'padding:3px 10px;font-size:0.82rem;width:70px;';
    editBtn.addEventListener('click', () => {
      resourceEditingId = item.id;
      pendingResourceFile = null;
      setResourceSourceType(item.resourceType === 'link' ? 'link' : 'file');
      const fileInput = document.getElementById('resourceFileInput');
      if (fileInput) fileInput.value = '';
      const linkInput = document.getElementById('resourceLinkInput');
      if (linkInput) linkInput.value = item.resourceType === 'link' ? item.fileUrl || '' : '';
      document.getElementById('resourceDocumentNameInput').value = item.documentName || '';
      document.getElementById('resourceDescriptionInput').value = item.description || '';
      populateResourcePoolOptions(document.getElementById('resourcePoolInput'), 'all', false);
      document.getElementById('resourcePoolInput').value = item.pool || '';
      const actionBtn = document.getElementById('resourceAddBtn');
      if (actionBtn) actionBtn.textContent = 'Save';
      document.getElementById('resourceTableSection')?.classList.remove('overlay-disabled');
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = 'Remove';
    removeBtn.className = 'submit-btn';
    removeBtn.style.cssText = 'padding:3px 10px;font-size:0.82rem;width:70px;';
    removeBtn.addEventListener('click', async () => {
      if (!confirm(`Remove "${item.documentName || item.fileName || 'this document'}"?`)) return;
      await deleteResourceRecord(item);
    });

    wrap.appendChild(editBtn);
    wrap.appendChild(removeBtn);
    actionsCell.appendChild(wrap);
    tbody.appendChild(tr);
  });

  const wrapper = tbody.closest('.table-scroll-wrap');
  if (wrapper) requestAnimationFrame(() => updateTableScrollShadow(wrapper));
}

function clearResourceForm() {
  resourceEditingId = '';
  pendingResourceFile = null;
  const ids = ['resourceDocumentNameInput', 'resourceDescriptionInput'];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const fileInput = document.getElementById('resourceFileInput');
  if (fileInput) fileInput.value = '';
  const linkInput = document.getElementById('resourceLinkInput');
  if (linkInput) linkInput.value = '';
  setResourceSourceType('file');
  const poolInput = document.getElementById('resourcePoolInput');
  if (poolInput) poolInput.value = '';
  const actionBtn = document.getElementById('resourceAddBtn');
  if (actionBtn) actionBtn.textContent = 'Add';
  document.getElementById('resourceTableSection')?.classList.add('overlay-disabled');
}

function timeoutAfter(ms, label) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Unable to read file.'));
    reader.readAsDataURL(file);
  });
}

function openResourceDataUrl(dataUrl) {
  if (!dataUrl || !dataUrl.startsWith('data:')) throw new Error('Invalid resource data.');
  const [header, b64] = dataUrl.split(',');
  const mime = header.split(':')[1].split(';')[0];
  const bytes = Uint8Array.from(atob(b64 || ''), c => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: mime });
  const blobUrl = URL.createObjectURL(blob);
  const win = window.open(blobUrl, '_blank');
  if (!win) URL.revokeObjectURL(blobUrl);
  else setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
}

function isFirebaseStorageCorsError(err) {
  const message = `${err?.code || ''} ${err?.message || ''}`.toLowerCase();
  return message.includes('cors')
    || message.includes('xmlhttprequest')
    || message.includes('preflight')
    || message.includes('net::err_failed')
    || message.includes('firebase storage upload timed out');
}

function isResourceStorageMarkedBlocked() {
  try {
    return sessionStorage.getItem(RESOURCE_STORAGE_BLOCKED_SESSION_KEY) === 'true';
  } catch (err) {
    return false;
  }
}

function markResourceStorageBlocked() {
  try {
    sessionStorage.setItem(RESOURCE_STORAGE_BLOCKED_SESSION_KEY, 'true');
  } catch (err) {
    // Non-critical: uploads can still fall back for this request.
  }
}

async function deleteResourceFileChunks(resourceId) {
  if (!resourceId) return;
  const chunksSnap = await getDocs(collection(db, 'resourcesDocuments', resourceId, 'fileChunks'));
  const chunkRefs = chunksSnap.docs.map((docSnap) => docSnap.ref);
  for (let i = 0; i < chunkRefs.length; i += 400) {
    const batch = writeBatch(db);
    chunkRefs.slice(i, i + 400).forEach((chunkRef) => batch.delete(chunkRef));
    await batch.commit();
  }
}

async function storeResourceFileInFirestoreChunks(file, resourceId, safeName) {
  if (!resourceId) throw new Error('Resource upload could not be prepared. Try again.');
  if (file.size > RESOURCE_FIRESTORE_MAX_FILE_SIZE) {
    throw new Error('This file is too large for the temporary Firestore upload fallback. Use a website link, or apply Firebase Storage CORS and try again.');
  }

  const dataUrl = await readFileAsDataURL(file);
  const [prefix, encoded = ''] = dataUrl.split(',');
  const chunks = [];
  for (let i = 0; i < encoded.length; i += RESOURCE_FIRESTORE_CHUNK_SIZE) {
    chunks.push(encoded.slice(i, i + RESOURCE_FIRESTORE_CHUNK_SIZE));
  }

  await deleteResourceFileChunks(resourceId);
  for (let i = 0; i < chunks.length; i += 400) {
    const batch = writeBatch(db);
    chunks.slice(i, i + 400).forEach((chunk, offset) => {
      const index = i + offset;
      const chunkId = String(index).padStart(4, '0');
      batch.set(doc(db, 'resourcesDocuments', resourceId, 'fileChunks', chunkId), {
        index,
        data: chunk,
      });
    });
    await batch.commit();
  }

  return {
    storagePath: '',
    fileUrl: `${FIRESTORE_RESOURCE_STORAGE}:${resourceId}`,
    fileName: file.name || safeName,
    storageType: FIRESTORE_RESOURCE_STORAGE,
    contentType: file.type || 'application/octet-stream',
    fileSize: file.size || 0,
    chunkCount: chunks.length,
    dataUrlPrefix: prefix,
  };
}

async function getFirestoreResourceDataUrl(resourceId) {
  const resource = resourcesData.find((item) => item.id === resourceId);
  if (!resource) throw new Error('Resource metadata was not found.');
  const chunksSnap = await getDocs(collection(db, 'resourcesDocuments', resourceId, 'fileChunks'));
  const chunks = chunksSnap.docs
    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
    .sort((a, b) => Number(a.index ?? a.id) - Number(b.index ?? b.id))
    .map((chunk) => chunk.data || '');
  if (!chunks.length) throw new Error('Resource file chunks were not found.');
  const prefix = resource.dataUrlPrefix || `data:${resource.contentType || 'application/octet-stream'};base64`;
  return `${prefix},${chunks.join('')}`;
}

async function uploadResourceFile(file, resourceId) {
  const safeName = `${Date.now()}_${String(file.name || 'resource').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  if (isResourceStorageMarkedBlocked()) {
    return storeResourceFileInFirestoreChunks(file, resourceId, safeName);
  }

  const path = `resources/${safeName}`;
  const storage = getResourceStorage();
  const refObj = storageRef(storage, path);
  try {
    await Promise.race([
      uploadBytes(refObj, file, { contentType: file.type || 'application/octet-stream' }),
      timeoutAfter(RESOURCE_STORAGE_UPLOAD_TIMEOUT_MS, 'Firebase Storage upload'),
    ]);
    const fileUrl = await Promise.race([
      getDownloadURL(refObj),
      timeoutAfter(RESOURCE_STORAGE_URL_TIMEOUT_MS, 'Firebase Storage download URL'),
    ]);
    return {
      storagePath: path,
      fileUrl,
      fileName: file.name || safeName,
      storageType: 'storage',
      contentType: file.type || 'application/octet-stream',
      fileSize: file.size || 0,
      chunkCount: 0,
      dataUrlPrefix: '',
    };
  } catch (err) {
    console.warn('[PoolPro] Storage upload failed for resource.', err);
    const isCorsBlocked = isFirebaseStorageCorsError(err);
    if (isCorsBlocked) markResourceStorageBlocked();
    const corsHint = isCorsBlocked
      ? ' Storage CORS is still blocked, so PoolPro saved this file through its Firestore fallback.'
      : ' Firebase Storage failed, so PoolPro saved this file through its Firestore fallback.';
    console.warn(`[PoolPro]${corsHint}`);
    return storeResourceFileInFirestoreChunks(file, resourceId, safeName);
  }
}

async function deleteResourceRecord(item) {
  try {
    await deleteResourceBackingFile(item);
    await deleteDoc(doc(db, 'resourcesDocuments', item.id));
    await loadResourcesDocuments();
    if (resourceEditingId === item.id) clearResourceForm();
  } catch (err) {
    console.error('[PoolPro] Unable to remove resource:', err);
    alert('Unable to remove this document right now.');
  }
}

async function deleteResourceBackingFile(item) {
  if (!item) return;
  if (item.storagePath) {
    await deleteObject(storageRef(getResourceStorage(), item.storagePath)).catch(() => {});
  }
  if (item.storageType === FIRESTORE_RESOURCE_STORAGE || item.fileUrl?.startsWith(`${FIRESTORE_RESOURCE_STORAGE}:`)) {
    await deleteResourceFileChunks(item.id).catch(() => {});
  }
}

async function loadResourcesDocuments() {
  try {
    const snap = await getDocs(query(collection(db, 'resourcesDocuments'), orderBy('sortDate', 'desc')));
    resourcesData = snap.docs.map((docSnap) => normalizeResourceRecord(docSnap.data(), docSnap.id));
  } catch (err) {
    console.error('[PoolPro] Error loading resources:', err);
    resourcesData = [];
  }
  renderResourcesPageTable();
  renderResourcesSettingsTable();
}

function setupResourcesPageFilters() {
  const marketFilter = document.getElementById('resourcesMarketFilter');
  const poolFilter = document.getElementById('resourcesPoolFilter');
  if (!marketFilter || !poolFilter) return;

  marketFilter.value = 'all';
  poolFilter.value = 'all';
  resourcePageMarketFilter = 'all';
  resourcePagePoolFilter = 'all';

  marketFilter.addEventListener('change', () => {
    resourcePageMarketFilter = marketFilter.value || 'all';
    resourcePagePoolFilter = 'all';
    populateResourcePoolOptions(poolFilter, resourcePageMarketFilter, true);
    poolFilter.value = 'all';
    renderResourcesPageTable();
  });

  poolFilter.addEventListener('change', () => {
    resourcePagePoolFilter = poolFilter.value || 'all';
    renderResourcesPageTable();
  });
}

function setupResourcesSettingsUI() {
  const sourceSelect = document.getElementById('resourceSourceTypeSelect');
  const fileInput = document.getElementById('resourceFileInput');
  const linkInput = document.getElementById('resourceLinkInput');
  const poolInput = document.getElementById('resourcePoolInput');
  const addBtn = document.getElementById('resourceAddBtn');
  const marketFilter = document.getElementById('resourceMarketFilter');
  const poolFilter = document.getElementById('resourcePoolFilter');
  const deleteAllBtn = document.getElementById('resourceDeleteAllBtn');

  if (!sourceSelect || !fileInput || !linkInput || !poolInput || !addBtn || !marketFilter || !poolFilter || !deleteAllBtn) return;
  if (addBtn.dataset.bound === 'true') return;
  addBtn.dataset.bound = 'true';

  setResourceSourceType(resourceSourceType);
  sourceSelect.addEventListener('change', () => {
    setResourceSourceType(sourceSelect.value);
  });

  fileInput.addEventListener('change', () => {
    pendingResourceFile = fileInput.files?.[0] || null;
  });

  marketFilter.value = 'all';
  poolFilter.value = 'all';

  marketFilter.addEventListener('change', () => {
    resourceSettingsMarketFilter = marketFilter.value || 'all';
    resourceSettingsPoolFilter = 'all';
    populateResourcePoolOptions(poolFilter, resourceSettingsMarketFilter, true);
    poolFilter.value = 'all';
    renderResourcesSettingsTable();
  });

  poolFilter.addEventListener('change', () => {
    resourceSettingsPoolFilter = poolFilter.value || 'all';
    renderResourcesSettingsTable();
  });

  addBtn.addEventListener('click', async () => {
    const documentName = document.getElementById('resourceDocumentNameInput')?.value.trim() || '';
    const description = document.getElementById('resourceDescriptionInput')?.value.trim() || '';
    const pool = poolInput.value || '';
    const market = getPoolMarket(pool);
    const mode = sourceSelect.value === 'link' ? 'link' : 'file';
    const normalizedLink = normalizeResourceLink(linkInput.value);

    if (!documentName || !description || !pool) {
      alert('Document Name, Description, and Facility are required.');
      return;
    }

    const existing = resourceEditingId
      ? resourcesData.find((item) => item.id === resourceEditingId)
      : null;
    const switchingLinkToFile = existing?.resourceType === 'link' && mode === 'file';
    if (mode === 'file' && (!existing || switchingLinkToFile) && !pendingResourceFile) {
      alert('Choose a file before adding a resource.');
      return;
    }
    if (mode === 'link' && !normalizedLink) {
      alert('Enter a valid website link before adding a resource.');
      return;
    }

    try {
      addBtn.disabled = true;
      addBtn.textContent = resourceEditingId ? 'Saving...' : 'Adding...';
      const targetRef = resourceEditingId
        ? doc(db, 'resourcesDocuments', resourceEditingId)
        : doc(collection(db, 'resourcesDocuments'));
      const targetId = targetRef.id;
      let fileMeta = existing ? {
        fileUrl: existing.fileUrl,
        fileName: existing.fileName,
        storagePath: existing.storagePath,
        storageType: existing.storageType,
        contentType: existing.contentType,
        fileSize: existing.fileSize,
        chunkCount: existing.chunkCount,
        dataUrlPrefix: existing.dataUrlPrefix,
      } : null;

      if (mode === 'link') {
        if (existing) await deleteResourceBackingFile(existing);
        fileMeta = {
          fileUrl: normalizedLink,
          fileName: '',
          storagePath: '',
          storageType: 'link',
          contentType: '',
          fileSize: 0,
          chunkCount: 0,
          dataUrlPrefix: '',
        };
      } else if (pendingResourceFile) {
        const oldStoragePath = existing?.storagePath || '';
        const hadChunkedFile = !!existing
          && (existing.storageType === FIRESTORE_RESOURCE_STORAGE
            || existing.fileUrl?.startsWith(`${FIRESTORE_RESOURCE_STORAGE}:`));
        if (hadChunkedFile) {
          await deleteResourceFileChunks(existing.id).catch(() => {});
        }
        fileMeta = await uploadResourceFile(pendingResourceFile, targetId);
        if (oldStoragePath && oldStoragePath !== fileMeta.storagePath) {
          await deleteObject(storageRef(getResourceStorage(), oldStoragePath)).catch(() => {});
        }
      }

      const uploadTimestampMs = Date.now();
      const isNewResourceValue = mode === 'link'
        ? normalizedLink !== existing?.fileUrl
        : !!pendingResourceFile || !existing;
      const uploadDate = isNewResourceValue
        ? new Date(uploadTimestampMs).toISOString().slice(0, 10)
        : existing?.uploadDate
          || (existing?.uploadedAt?.toDate ? existing.uploadedAt.toDate().toISOString().slice(0, 10) : '')
          || new Date(uploadTimestampMs).toISOString().slice(0, 10);
      const sortDate = isNewResourceValue
        ? uploadTimestampMs
        : existing?.sortDate || uploadTimestampMs;

      const payload = normalizeResourceRecord({
        documentName,
        uploadDate,
        description,
        market,
        pool,
        fileUrl: fileMeta?.fileUrl || '',
        fileName: fileMeta?.fileName || '',
        storagePath: fileMeta?.storagePath || '',
        storageType: fileMeta?.storageType || '',
        contentType: fileMeta?.contentType || '',
        fileSize: fileMeta?.fileSize || 0,
        chunkCount: fileMeta?.chunkCount || 0,
        dataUrlPrefix: fileMeta?.dataUrlPrefix || '',
        resourceType: mode,
        sortDate,
        uploadedAt: isNewResourceValue ? null : existing?.uploadedAt || null,
      }, resourceEditingId);

      await setDoc(targetRef, {
        documentName: payload.documentName,
        description: payload.description,
        market: payload.market,
        pool: payload.pool,
        fileUrl: payload.fileUrl,
        fileName: payload.fileName,
        storagePath: payload.storagePath,
        storageType: payload.storageType,
        contentType: payload.contentType,
        fileSize: payload.fileSize,
        chunkCount: payload.chunkCount,
        dataUrlPrefix: payload.dataUrlPrefix,
        resourceType: payload.resourceType,
        sortDate: payload.sortDate,
        uploadDate: payload.uploadDate,
        uploadedAt: isNewResourceValue ? serverTimestamp() : existing?.uploadedAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });

      clearResourceForm();
      await loadResourcesDocuments();
    } catch (err) {
      console.error('[PoolPro] Unable to save resource:', err);
      alert(err?.message || 'Unable to save this document right now.');
    } finally {
      addBtn.disabled = false;
      addBtn.textContent = resourceEditingId ? 'Save' : 'Add';
    }
  });

  deleteAllBtn.addEventListener('click', async () => {
    if (!resourcesData.length) {
      alert('There are no files to delete.');
      return;
    }
    if (!confirm('Delete all uploaded files and resource records? This cannot be undone.')) return;

    try {
      const removals = resourcesData.map(async (item) => {
        await deleteResourceBackingFile(item);
        await deleteDoc(doc(db, 'resourcesDocuments', item.id));
      });
      await Promise.all(removals);
      clearResourceForm();
      await loadResourcesDocuments();
    } catch (err) {
      console.error('[PoolPro] Unable to delete all resource files:', err);
      alert('Unable to delete all files right now.');
    }
  });
}

function setupSettingsAccordions() {
  normalizeNestedSettingsSections();
  const sections = Array.from(document.querySelectorAll('#settingsModal .settings-section'));

  sections.forEach((section) => {
    const title = section.querySelector(':scope > h3, :scope > #sanitationMethodsSection > h3');
    if (!title || section.dataset.accordionReady === 'true') return;
    const titleContainer = title.parentElement === section ? section : title.parentElement;

    const content = document.createElement('div');
    content.className = 'settings-section-body';
    const contentInner = document.createElement('div');
    contentInner.className = 'settings-section-body-inner';

    Array.from(titleContainer.children).forEach((child) => {
      if (child !== title) contentInner.appendChild(child);
    });

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'settings-section-toggle';
    button.innerHTML = `<span class="settings-section-title">${title.textContent}</span><span class="settings-section-caret">▾</span>`;

    title.replaceWith(button);
    content.appendChild(contentInner);
    titleContainer.appendChild(content);
    section.classList.add('collapsed');
    section.dataset.accordionReady = 'true';

    button.addEventListener('click', () => {
      const isCollapsed = section.classList.contains('collapsed');
      section.classList.toggle('collapsed', !isCollapsed);
    });
  });
}

function normalizeNestedSettingsSections() {
  const modalContent = document.querySelector('#settingsModal .settings-modal-content');
  if (!modalContent) return;

  let moved = true;
  while (moved) {
    moved = false;
    const nestedSections = Array.from(modalContent.querySelectorAll('.settings-section .settings-section'));
    nestedSections.reverse().forEach((nested) => {
      const parent = nested.parentElement?.closest('.settings-section');
      if (!parent) return;
      parent.insertAdjacentElement('afterend', nested);
      moved = true;
    });
  }
}

// ============================================================
// SANITATION METHODS
// ============================================================

// Saved selections: poolId → 'bleach' | 'granular'
let sanitationData = {};

async function loadSanitationMethods() {
  const container = document.getElementById('sanitationTablesContainer');
  if (!container) return;

  if (!poolsCache.length) {
    setTimeout(loadSanitationMethods, 300);
    return;
  }

  try {
    const snap = await getDoc(doc(db, 'settings', 'sanitation'));
    sanitationData = snap.exists() ? (snap.data().pools || {}) : {};
  } catch (err) {
    console.error('[ChemLog] Error loading sanitation methods:', err);
    sanitationData = {};
  }

  renderSanitationTables(container);
}

function renderSanitationTables(container) {
  container.innerHTML = '';
  const groups = groupPoolsByMarket(poolsCache);
  if (!groups.length) {
    container.innerHTML = '<p style="color:#888;font-size:0.9rem;">No pools configured yet. Add pools in the Site Editor.</p>';
    return;
  }

  const rows = groups.flatMap(({ market, pools: mPools }) =>
    mPools.map((pool) => ({ market, pool }))
  );

  const filterBar = document.createElement('div');
  filterBar.className = 'training-filter-bar sanitation-filter-bar';
  filterBar.innerHTML = `
    <span class="filter-by-label">Filter By:</span>
    <select id="sanitationMarketFilter" class="training-filter-select">
      <option value="all">All Markets</option>
      ${groups.map(({ market }) => `<option value="${market}">${market}</option>`).join('')}
    </select>
  `;
  container.appendChild(filterBar);

  const marketFilter = filterBar.querySelector('#sanitationMarketFilter');
  marketFilter.value = sanitationMarketFilter;
  marketFilter.addEventListener('change', () => {
    sanitationMarketFilter = marketFilter.value || 'all';
    renderSanitationTables(container);
  });

  const controlsWrap = document.createElement('div');
  controlsWrap.className = 'toggle-btn sanitation-market-controls';
  controlsWrap.innerHTML = `
    <div class="sanitation-controls">
      <div class="sanitation-controls-thumb" style="transform:${sanitationEditing ? 'translateX(0%)' : 'translateX(100%)'}"></div>
      <button type="button" class="editAndSave${sanitationEditing ? ' active' : ''}" ${sanitationEditing ? 'disabled' : ''}>Edit</button>
      <button type="button" class="editAndSave${sanitationEditing ? '' : ' active'}" ${sanitationEditing ? '' : 'disabled'}>Save</button>
    </div>
  `;
  container.appendChild(controlsWrap);

  const tableWrap = document.createElement('div');
  tableWrap.className = 'sanitation-market-table-wrap sanitation-section';
  if (!sanitationEditing) tableWrap.classList.add('overlay-disabled');

  const table = document.createElement('table');
  table.className = 'sanitation-table sanitation-table--settings';
  table.innerHTML = '<thead><tr><th>Facility</th><th>Pool</th><th>Bleach</th><th>Granular</th><th>Tablet</th><th>No Changes</th></tr></thead>';
  const tbody = document.createElement('tbody');

  const filteredRows = rows.filter(({ market }) => sanitationMarketFilter === 'all' || market === sanitationMarketFilter);

  filteredRows.forEach(({ market, pool }) => {
    const numPools = Math.max(1, Number(pool.numPools || pool.poolCount || 1));
    const poolLabels = Array.from({ length: numPools }, (_, i) =>
      i === 0 ? 'Pool 1 (Main)' : i === 1 ? 'Pool 2' : `Pool ${i + 1}`
    );

    poolLabels.forEach((poolLabel, poolIdx) => {
      const key = `${pool.id}::${poolIdx}`;
      const saved = sanitationData[key] || sanitationData[pool.id] || 'bleach';
      const tr = document.createElement('tr');

      if (poolIdx === 0) {
        const facilityTd = document.createElement('td');
        facilityTd.textContent = pool.name || pool.id;
        if (numPools > 1) facilityTd.rowSpan = numPools;
        tr.appendChild(facilityTd);
      }

      const poolTd = document.createElement('td');
      poolTd.textContent = poolLabel;
      tr.appendChild(poolTd);

      const methods = ['bleach', 'granular', 'tablet', 'off'];
      const cbs = methods.map((method) => {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'market-filter-checkbox';
        cb.checked = saved === method;
        cb.disabled = !sanitationEditing;
        return cb;
      });

      const updateSelection = (method) => {
        sanitationData[key] = method;
        cbs.forEach((cb, i) => { cb.checked = methods[i] === method; });
      };

      cbs.forEach((cb, i) => {
        cb.addEventListener('change', () => { if (cb.checked) updateSelection(methods[i]); });
        const td = document.createElement('td');
        td.style.textAlign = 'center';
        td.appendChild(cb);
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });
  });

  table.appendChild(tbody);
  tableWrap.appendChild(table);
  container.appendChild(tableWrap);
  wrapResponsiveTables(container);
  table.closest('.table-scroll-wrap')?.classList.add('sanitation-settings-scroll');

  const [editBtn, saveBtn] = controlsWrap.querySelectorAll('.editAndSave');
  editBtn?.addEventListener('click', () => {
    sanitationEditing = true;
    renderSanitationTables(container);
  });
  saveBtn?.addEventListener('click', async () => {
    try {
      await setDoc(doc(db, 'settings', 'sanitation'), { pools: sanitationData }, { merge: true });
    } catch (err) {
      console.error('[ChemLog] Error saving sanitation methods:', err);
    }
    sanitationEditing = false;
    renderSanitationTables(container);
  });
}

// Legacy stub — no longer needed but kept to avoid reference errors
function setupSanitationControls() {}

// ============================================================
// ============================================================
// EMPLOYEE TABLE — Section-level overlay with Edit/Save toggle
// ============================================================

function setupEmployeeOverlay() {
  const editBtn = document.getElementById('employeeEditBtn');
  const saveBtn = document.getElementById('employeeSaveBtn');
  const section = document.getElementById('employeeTableSection');
  if (!editBtn || !saveBtn || !section) return;

  editBtn.addEventListener('click', () => {
    section.classList.remove('overlay-disabled');
    editBtn.classList.remove('active');
    saveBtn.classList.add('active');
    editBtn.disabled = true;
    saveBtn.disabled = false;
  });

  saveBtn.addEventListener('click', () => {
    section.classList.add('overlay-disabled');
    saveBtn.classList.remove('active');
    editBtn.classList.add('active');
    saveBtn.disabled = true;
    editBtn.disabled = false;
    editingEmployeeIdx = -1;
    const addBtn = document.getElementById('employeeAddBtn');
    if (addBtn) addBtn.textContent = 'Add';
  });
}

function setSegmentedToggleThumb(container, activeSide) {
  if (!container) return;
  let thumb = container.querySelector('.sanitation-controls-thumb');
  if (!thumb) {
    thumb = document.createElement('div');
    thumb.className = 'sanitation-controls-thumb';
    container.prepend(thumb);
  }
  thumb.style.transform = activeSide === 'edit' ? 'translateX(0%)' : 'translateX(100%)';
}

// MARKET SECTION — Edit/Save toggle with overlay
// ============================================================

function setupMarketEditSave() {
  const editBtn = document.getElementById('marketEditBtn');
  const saveBtn = document.getElementById('marketSaveBtn');
  const section = document.getElementById('marketSection');
  if (!editBtn || !saveBtn || !section) return;
  const controls = editBtn.closest('.sanitation-controls');

  // Start in read-only mode
  section.classList.add('overlay-disabled');
  setSegmentedToggleThumb(controls, 'edit');

  editBtn.addEventListener('click', () => {
    section.classList.remove('overlay-disabled');
    editBtn.classList.remove('active');
    saveBtn.classList.add('active');
    editBtn.disabled = true;
    saveBtn.disabled = false;
    setSegmentedToggleThumb(controls, 'save');
    section.querySelectorAll('.market-filter-checkbox').forEach(cb => { cb.disabled = false; });
  });

  saveBtn.addEventListener('click', () => {
    const selected = Array.from(section.querySelectorAll('.market-filter-checkbox:checked')).map(c => c.value);
    localStorage.setItem('chemlogMarkets', JSON.stringify(selected));
    section.classList.add('overlay-disabled');
    saveBtn.classList.remove('active');
    editBtn.classList.add('active');
    saveBtn.disabled = true;
    editBtn.disabled = false;
    setSegmentedToggleThumb(controls, 'edit');
    section.querySelectorAll('.market-filter-checkbox').forEach(cb => { cb.disabled = true; });
  });

  // Disable checkboxes initially
  section.querySelectorAll('.market-filter-checkbox').forEach(cb => { cb.disabled = true; });
}

// ============================================================
// DATA EXPORT — CSV
// ============================================================

function setupDataExport() {
  const exportBtn = document.getElementById('exportCsvBtn');
  if (!exportBtn) return;
  exportBtn.addEventListener('click', () => {
    if (!allLogs.length) { alert('No data to export.'); return; }
    const headers = ['Timestamp', 'Pool', 'MainPH', 'MainCl', 'SecondaryPH', 'SecondaryCl'];
    const rows = allLogs.map(log => {
      const ts = log.timestamp?.toDate?.()?.toISOString() || '';
      return [ts, log.poolLocation || '', log.mainPoolPH || '', log.mainPoolCl || '',
        log.secondaryPoolPH || '', log.secondaryPoolCl || ''].map(v => `"${v}"`).join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chemlog_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  });
}

// ============================================================
// CLEAR ALL DATA
// ============================================================

function setupClearData() {
  const clearBtn = document.getElementById('clearAllData');
  if (!clearBtn) return;
  clearBtn.addEventListener('click', async () => {
    if (!confirm('Delete ALL chemistry log data? This cannot be undone.')) return;
    try {
      clearBtn.disabled = true;
      const snap = await getDocs(collection(db, 'poolSubmissions'));
      const batch = writeBatch(db);
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      allLogs = [];
      filteredLogs = [];
      renderDashboard();
      alert('All chemistry log data has been cleared.');
    } catch (err) {
      console.error('[ChemLog] Error clearing data:', err);
      alert('Error clearing data. Please try again.');
    } finally {
      clearBtn.disabled = false;
    }
  });
}

// ============================================================
// DARK MODE
// ============================================================

function setupDarkMode() {
  document.body.classList.add('dark-mode');
  localStorage.setItem('chemlogDarkMode', 'true');
  setTimeout(() => document.body.classList.add('dark-mode-transition'), 50);
}

// ============================================================
// MARKET FILTER CHECKBOXES (settings modal)
// ============================================================

function setupMarketFilters() {
  const checkboxes = document.querySelectorAll('.market-filter-checkbox');
  if (!checkboxes.length) return;
  try {
    const saved = JSON.parse(localStorage.getItem('chemlogMarkets') || '[]');
    if (saved.length) {
      checkboxes.forEach(cb => { cb.checked = saved.includes(cb.value); });
    } else {
      // Default: all selected
      checkboxes.forEach(cb => { cb.checked = true; });
    }
  } catch (_) { /* ignore */ }
  checkboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      const selected = Array.from(checkboxes).filter(c => c.checked).map(c => c.value);
      localStorage.setItem('chemlogMarkets', JSON.stringify(selected));
    });
  });
}

// ============================================================
// TRAINING SESSIONS — public tables (fetched from Firestore)
// ============================================================

function getMonthKey(dateStr) {
  if (!dateStr) return null;
  // Add T12:00:00 to avoid timezone shifting the date
  const d = new Date(dateStr + 'T12:00:00');
  const m = d.getMonth(); // 0-based
  if (m === 4) return 'may';
  if (m === 5) return 'june';
  if (m === 6) return 'july';
  return null;
}

function formatDateNice(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function loadPublicTrainingSessions() {
  const mayBody = document.getElementById('publicTrainingSessionsMayBody');
  const juneBody = document.getElementById('publicTrainingSessionsJuneBody');
  const julyBody = document.getElementById('publicTrainingSessionsJulyBody');
  if (!mayBody && !juneBody && !julyBody) return; // Not on training page

  try {
    // Sessions are stored in the settings collection at settings/trainingSchedule
    const snap = await getDoc(doc(db, 'settings', 'trainingSchedule'));
    const sessions = snap.exists() ?
      (Array.isArray(snap.data().sessions) ? snap.data().sessions : []) :
      [];

    // Clear existing rows
    [mayBody, juneBody, julyBody].filter(Boolean).forEach(tb => { tb.innerHTML = ''; });

    sessions.forEach(session => {
      const monthKey = getMonthKey(session.date);
      let tbody = null;
      if (monthKey === 'may') tbody = mayBody;
      else if (monthKey === 'june') tbody = juneBody;
      else if (monthKey === 'july') tbody = julyBody;
      if (!tbody) return;

      const taken = Array.isArray(session.attendees) ? session.attendees.length : 0;
      const capacity = session.capacity || 0;
      const spotsText = capacity ? `${taken} / ${capacity}` : `${taken} signed up`;

      const locationLines = [session.pool, session.address].filter(Boolean).join('<br>');
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${session.trainingType || ''}</td>
        <td>${formatDateNice(session.date)}<br>${session.time || ''}</td>
        <td>${locationLines}</td>
        <td>${session.notes || ''}</td>
        <td>${spotsText}</td>
      `;
      tbody.appendChild(tr);
    });

    // Show empty-state row if no sessions for a month
    [mayBody, juneBody, julyBody].filter(Boolean).forEach(tbody => {
      if (!tbody.querySelector('tr')) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="5" style="text-align:center;color:grey;padding:12px;">No sessions scheduled yet.</td>';
        tbody.appendChild(tr);
      }
    });

  } catch (err) {
    console.error('[ChemLog] Error loading training sessions:', err);
    [mayBody, juneBody, julyBody].filter(Boolean).forEach(tbody => {
      tbody.innerHTML = '<tr><td colspan="5" style="color:red;padding:8px;">Error loading sessions. Check console.</td></tr>';
    });
  }
}

// Called by training.js when a lifeguard submits the signup form
// Writes to the trainingSignups collection (allow read, write: if true)
window.loadTrainingSessionsFromFirestore = async function () {
  try {
    const snap = await getDoc(doc(db, 'settings', 'trainingSchedule'));
    if (snap.exists()) {
      const data = snap.data();
      if (Array.isArray(data.sessions)) return data.sessions;
    }
  } catch (err) {
    console.error('[ChemLog] Error loading training sessions from Firestore:', err);
  }
  return null;
};

window.syncTrainingSessionsToFirestore = async function (sessions) {
  if (!Array.isArray(sessions)) return;
  try {
    await setDoc(doc(db, 'settings', 'trainingSchedule'), { sessions }, { merge: false });
  } catch (err) {
    console.error('[ChemLog] Error syncing training sessions to Firestore:', err);
  }
};

// Expose employee lookup so training.js can resolve phone numbers by employee ID or email
window.getEmployeeByID = function (idOrEmail) {
  if (!idOrEmail) return null;
  const val = String(idOrEmail).toLowerCase();
  return employeesData.find(e =>
    String(e.email || '').toLowerCase() === val ||
    String(e.id || '').toLowerCase() === val ||
    String(e.username || '').toLowerCase() === val
  ) || null;
};
window.getEmployeeByEmail = window.getEmployeeByID;

window.addTrainingSignupToSchedule = async function ({ sessionId, firstName, lastName, homePool, email }) {
  if (!sessionId) return;
  try {
    await addDoc(collection(db, 'trainingSignups'), {
      sessionId,
      firstName: firstName || '',
      lastName: lastName || '',
      homePool: homePool || '',
      email: email || '',
      signedUpAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('[ChemLog] Error saving training signup to Firestore:', err);
  }
};

window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href]');
  if (!link) return;
  const href = link.getAttribute('href') || '';
  if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
  if (link.target && link.target !== '_self') return;
  try {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return;
    url.searchParams.set('_reload', String(Date.now()));
    link.href = url.pathname + url.search + url.hash;
  } catch (_) {
    // Ignore malformed URLs
  }
});

// ============================================================
// SUPERVISOR DASHBOARD ANCHOR — handle #supervisorDashboard
// in the URL when redirecting from training.html
// ============================================================

function checkDashboardAnchor() {
  if (window.location.hash === '#supervisorDashboard') {
    const dashboard = document.getElementById('supervisorDashboard');
    if (dashboard) {
      if (!canAccessPoolChemistryDashboard()) return;
      const mainForm = document.getElementById('mainForm');
      if (mainForm) mainForm.style.display = 'none';
      dashboard.classList.add('show');
      applyDashboardAccessMode();
      loadDashboardData();
    }
  }
}

// ============================================================
// BOOT — wire everything up on DOMContentLoaded
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  restoreLifeguardSessionFromLocalStorage();
  await loadRolesPermissions();
  mountUnifiedFooter();
  normalizeSharedHeaderCopy();
  injectOperationalStatusMenuLinks();
  injectManagerialReportMenuLinks();
  injectResourcesMenuLinks();
  injectLifeguardSettingsMenuLinks();
  ensureResourcesSettingsSection();
  ensureSettingsModalScrollBody();
  setupAccountManagement();
  setupSettingsAccordions();
  wrapResponsiveTables();
  observeResponsiveTables();
  const feedbackModal = document.getElementById('feedbackModal');
  if (feedbackModal) {
    feedbackModal.addEventListener('click', (event) => {
      if (event.target === feedbackModal) {
        window.closeModal();
      }
    });
  }
  // Firebase Auth state listener — keeps localStorage flags in sync and updates nav
  onAuthStateChanged(auth, async (user) => {
    if (accountDeletionInProgress) return;
    const role = hasFreshSupervisorToken()
      ? 'supervisor'
      : (sessionStorage.getItem('chemlogRole') || localStorage.getItem('chemlogRole'));
    if (user) {
      if (role === 'lifeguard') {
        await user.reload().catch(() => {});
        if (!auth.currentUser?.emailVerified) {
          signOut(auth).catch(() => {});
          window.setupDropdownVisibility();
          return;
        }
        localStorage.removeItem('loginToken');
        localStorage.removeItem('ChemLogSupervisor');
        localStorage.removeItem('trainingSupervisorLoggedIn');
        localStorage.removeItem('training_supervisor_logged_in_v1');
        localStorage.removeItem('chemlogTrainingSupervisorLoggedIn');
        window.setupDropdownVisibility();
        return;
      }
      // Enforce fresh email auth every 5 hours.
      let token = null;
      try {
        token = JSON.parse(localStorage.getItem('loginToken') || 'null');
      } catch (_) {
        token = null;
      }
      const stillFresh = !!(token && token.expires && Date.now() < Number(token.expires));
      if (!stillFresh) {
        signOut(auth).catch(() => {});
        localStorage.removeItem('loginToken');
        localStorage.removeItem('ChemLogSupervisor');
        localStorage.removeItem('trainingSupervisorLoggedIn');
        localStorage.removeItem('training_supervisor_logged_in_v1');
        localStorage.removeItem('chemlogTrainingSupervisorLoggedIn');
      } else {
        localStorage.setItem('ChemLogSupervisor', 'true');
        localStorage.setItem('chemlogTrainingSupervisorLoggedIn', 'true');
        await enforceAgreementForCurrentUser();
      }
    } else {
      // Signed out: clear supervisor flags (but don't redirect — may be lifeguard session)
      clearSupervisorLoginState();
    }
    window.setupDropdownVisibility();
  });

  normalizeSharedHeaderCopy();
  setupFloatingHeaders();
  removeSiteAppearanceSections();

  // Show/hide supervisor-only dropdown items (initial render before auth resolves)
  window.setupDropdownVisibility();

  // Dark mode (toggle state sync — already applied before load)
  setupDarkMode();

  // Market filter checkboxes in settings
  setupMarketFilters();
  setupResourcesPageFilters();
  setupResourcesSettingsUI();

  // Load pools from Firestore and populate all dropdowns
  listenPools(populatePoolSelects);
  setupOperationalStatusLog();

  // Chemistry form submission
  setupChemForm();

  // Employee management
  await loadSecuritySettings();
  await loadEmployees();
  ensureRolesPermissionsSettingsSection();
  await loadResourcesDocuments();
  setupEmployeeManagement();
  setupEmployeeOverlay();
  await enforceAgreementForCurrentUser();
  setupDeleteAllEmployees();
  setupEmployeeFilters();
  setupSecuritySettingsUI();
  applySecuritySessionTimeout();

  // Market section edit/save toggle
  setupMarketEditSave();

  // Sanitation methods
  loadSanitationMethods();

  // Data export + clear data
  setupDataExport();
  setupClearData();

  // Training session public tables
  loadPublicTrainingSessions();

  // Handle #supervisorDashboard anchor (redirect from training page)
  checkDashboardAnchor();

  // Load dashboard data if already on the dashboard and supervisor
  const dashboard = document.getElementById('supervisorDashboard');
  if (dashboard && dashboard.classList.contains('show') && canAccessPoolChemistryDashboard()) {
    loadDashboardData();
  }

  // Supervisor Dashboard tab switching (Pool Chemistry vs Cleanliness Reports)
  const dashTabs = document.querySelectorAll('[data-dash-tab]');
  dashTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      if (!isSupervisor() && tab.dataset.dashTab !== 'chemistry') return;
      dashTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const which = tab.dataset.dashTab;
      const chemPanel = document.getElementById('dashboardContent');
      const jobPanel = document.getElementById('jobFormsContent');
      if (which === 'chemistry') {
        if (chemPanel) chemPanel.style.display = '';
        if (jobPanel) jobPanel.style.display = 'none';
        if (allLogs.length) renderDashboard(allLogs);
        else loadDashboardData();
      } else if (which === 'jobforms') {
        if (chemPanel) chemPanel.style.display = 'none';
        if (jobPanel) { jobPanel.style.display = ''; loadJobFormSubmissions(); }
      }
    });
  });
});

// ============================================================
// JOB FORM SUBMISSIONS (Duties page results)
// ============================================================

async function loadJobFormSubmissions() {
  const container = document.getElementById('jobFormsContent');
  if (!container) return;
  if (!isSupervisor()) {
    container.innerHTML = '<p style="padding:16px;color:#c0392b;">You do not have permission to view cleanliness report submissions.</p>';
    return;
  }
  container.innerHTML = '<p style="padding:16px;color:#666;">Loading submissions…</p>';

  try {
    const q = query(collection(db, 'dutySubmissions'), orderBy('timestamp', 'desc'));
    const snap = await getDocs(q);
    const submissions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderJobFormSubmissions(submissions, container);
  } catch (err) {
    console.error('[Duties] Error loading submissions:', err);
    container.innerHTML = '<p style="color:red;padding:16px;">Error loading submissions.</p>';
  }
}

function renderJobFormSubmissions(submissions, container) {
  container.innerHTML = '';

  renderDashboardFilterBar(container, () => renderJobFormSubmissions(submissions, container));

  const marketMap = getDashboardMarketMap({ docs: false });
  const marketsToShow = getVisibleDashboardMarkets(marketMap);
  const submissionsForDate = submissions.filter((sub) => isDashboardDate(sub.timestamp, dashboardDateFilter));

  if (!marketsToShow.length) {
    container.insertAdjacentHTML('beforeend', '<p style="padding:16px;color:#666;">No markets selected. Enable markets in Settings.</p>');
    return;
  }

  if (dashboardPoolFilter !== 'all') {
    const poolSubs = submissionsForDate.filter((sub) => sub.pool === dashboardPoolFilter);
    const totalPages = Math.max(1, Math.ceil(poolSubs.length / DASHBOARD_PAGE_SIZE));
    dashboardJobPage = Math.min(Math.max(1, dashboardJobPage), totalPages);
    const pageSubs = poolSubs.slice((dashboardJobPage - 1) * DASHBOARD_PAGE_SIZE, dashboardJobPage * DASHBOARD_PAGE_SIZE);

    const section = document.createElement('div');
    section.className = 'dashboard-market-section dashboard-single-pool-section';
    const h2 = document.createElement('h2');
    h2.className = 'dashboard-market-heading';
    h2.textContent = dashboardPoolFilter;
    section.appendChild(h2);

    const table = document.createElement('table');
    table.className = 'data-table dashboard-pool-table dashboard-detail-table dashboard-cleanliness-table';
    table.innerHTML = '<thead><tr><th>Form</th><th>Facility Name</th><th>Respondent</th><th>Timestamp</th></tr></thead>';
    const tbody = document.createElement('tbody');

    if (!pageSubs.length) {
      tbody.innerHTML = '<tr><td colspan="4">No cleanliness reports match the selected filters.</td></tr>';
    } else {
      pageSubs.forEach((sub) => {
        const ts = toDateObject(sub.timestamp);
        const tr = document.createElement('tr');
        const tdForm = document.createElement('td');
        tdForm.appendChild(createDutyFormLink(sub));
        tr.appendChild(tdForm);
        tr.insertAdjacentHTML('beforeend', `
          <td>${escapeHtml(sub.pool || '—')}</td>
          <td>${escapeHtml(sub.submitterEmail || '—')}</td>
          <td>${ts ? ts.toLocaleString() : '—'}</td>
        `);
        tbody.appendChild(tr);
      });
    }

    table.appendChild(tbody);
    section.appendChild(table);
    renderDashboardPagination(section, {
      page: dashboardJobPage,
      totalRows: poolSubs.length,
      onPageChange: (nextPage) => {
        dashboardJobPage = nextPage;
        renderJobFormSubmissions(submissions, container);
      },
    });
    container.appendChild(section);
    wrapResponsiveTables(container);
    return;
  }

  let renderedAny = false;
  marketsToShow.forEach((market) => {
    const poolNames = marketMap[market] || [];
    if (!poolNames.length) return;

    const section = document.createElement('div');
    section.className = 'dashboard-market-section';
    const h2 = document.createElement('h2');
    h2.className = 'dashboard-market-heading';
    h2.textContent = market;
    section.appendChild(h2);

    const table = document.createElement('table');
    table.className = 'data-table dashboard-pool-table dashboard-cleanliness-table';
    table.innerHTML = '<thead><tr><th>Facility Name</th><th>Form</th><th>Respondent</th><th>Timestamp</th></tr></thead>';
    const tbody = document.createElement('tbody');

    poolNames.forEach((poolName) => {
      const mostRecent = submissionsForDate.find((sub) => sub.pool === poolName);
      const ts = toDateObject(mostRecent?.timestamp);
      const tr = document.createElement('tr');
      const facilityTd = document.createElement('td');
      facilityTd.textContent = poolName;
      const formTd = document.createElement('td');
      if (mostRecent) formTd.appendChild(createDutyFormLink(mostRecent));
      else formTd.textContent = 'No report';

      tr.appendChild(facilityTd);
      tr.appendChild(formTd);
      tr.insertAdjacentHTML('beforeend', `
        <td>${escapeHtml(mostRecent?.submitterEmail || '—')}</td>
        <td>${ts ? ts.toLocaleString() : '—'}</td>
      `);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    section.appendChild(table);
    container.appendChild(section);
    renderedAny = true;
  });

  if (!renderedAny) {
    container.insertAdjacentHTML('beforeend', '<p style="padding:8px 0;color:#666;">No cleanliness reports match the selected filters.</p>');
  }

  wrapResponsiveTables(container);
}

function createDutyFormLink(sub) {
  const formLink = document.createElement('a');
  formLink.href = '#';
  formLink.className = 'dashboard-form-link';
  formLink.textContent = 'Cleanliness Report';
  formLink.addEventListener('click', (event) => {
    event.preventDefault();
    openDutyFormModal(sub);
  });
  return formLink;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseScaleNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mixColor(startHex, endHex, amount) {
  const parse = (hex) => {
    const clean = hex.replace('#', '');
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  };
  const [sr, sg, sb] = parse(startHex);
  const [er, eg, eb] = parse(endHex);
  const t = clampNumber(amount, 0, 1);
  const toHex = (n) => Math.round(n).toString(16).padStart(2, '0');
  return `#${toHex(sr + (er - sr) * t)}${toHex(sg + (eg - sg) * t)}${toHex(sb + (eb - sb) * t)}`;
}

function colorFromStops(value, stops) {
  const v = clampNumber(value, stops[0].value, stops[stops.length - 1].value);
  for (let i = 0; i < stops.length - 1; i++) {
    const current = stops[i];
    const next = stops[i + 1];
    if (v >= current.value && v <= next.value) {
      const span = next.value - current.value || 1;
      return mixColor(current.color, next.color, (v - current.value) / span);
    }
  }
  return stops[stops.length - 1].color;
}

const DUTY_SCALE_RED = '#a40000';
const DUTY_SCALE_YELLOW = '#d4a900';
const DUTY_SCALE_GREEN = '#18873b';

function getDutyScaleConfig(type, rawValue) {
  const value = parseScaleNumber(rawValue);
  if (value === null) return null;

  if (type === 'cya') {
    return {
      percent: clampNumber(value, 0, 100),
      color: colorFromStops(value, [
        { value: 0, color: DUTY_SCALE_RED },
        { value: 10, color: DUTY_SCALE_RED },
        { value: 30, color: DUTY_SCALE_YELLOW },
        { value: 50, color: DUTY_SCALE_GREEN },
        { value: 60, color: DUTY_SCALE_YELLOW },
        { value: 70, color: DUTY_SCALE_RED },
        { value: 100, color: DUTY_SCALE_RED },
      ]),
      trackClass: 'duty-scale-track-cya',
    };
  }

  if (type === 'acid') {
    return {
      percent: clampNumber((value / 30) * 100, 0, 100),
      color: colorFromStops(value, [
        { value: 0, color: DUTY_SCALE_RED },
        { value: 15, color: DUTY_SCALE_YELLOW },
        { value: 30, color: DUTY_SCALE_GREEN },
      ]),
      trackClass: 'duty-scale-track-acid',
    };
  }

  return {
    percent: clampNumber(value, 0, 100),
    color: colorFromStops(value, [
      { value: 0, color: DUTY_SCALE_RED },
      { value: 50, color: DUTY_SCALE_YELLOW },
      { value: 100, color: DUTY_SCALE_GREEN },
    ]),
    trackClass: 'duty-scale-track-linear',
  };
}

function dutyScaleHtml(label, value, unit, type) {
  const config = getDutyScaleConfig(type, value);
  if (!config) return '';
  const displayValue = `${escapeHtml(value)}${escapeHtml(unit || '')}`;
  return `
    <div class="duty-scale-row">
      <div class="duty-scale-label-row">
        <span>${escapeHtml(label)}</span>
        <strong>${displayValue}</strong>
      </div>
      <div class="duty-scale-track ${config.trackClass}">
        <span class="duty-scale-marker" style="left:${config.percent}%;background:${config.color};"></span>
      </div>
    </div>
  `;
}

function openDutyFormModal(sub) {
  let modal = document.getElementById('dutyFormModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'dutyFormModal';
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
    document.body.appendChild(modal);
  }
  modal.className = 'duty-report-modal';
  modal.style.cssText = '';

  const ts = toDateObject(sub.timestamp);
  const esc = escapeHtml;

  const photoSectionHtml = (label, photos) => {
    if (!photos?.length) return '';
    const imgs = photos.map((p) => {
      const encodedUrl = encodeURIComponent(p.url || '');
      return `<img src="${esc(p.url)}" alt="photo" class="duty-report-photo"
           onclick="window.openPhotoModal(decodeURIComponent('${encodedUrl}'))" />`;
    }).join('');
    return `<section class="duty-report-photo-section">
      <h4>${esc(label)}</h4>
      <div class="duty-report-photo-grid">${imgs}</div>
    </section>`;
  };

  const photos = sub.photos || {};
  const hasValue = (value) => value !== null && value !== undefined && value !== '';
  const hasManagerData = hasValue(sub.bleachVolume) || hasValue(sub.muriaticAcid) ||
    hasValue(sub.shockGranular) || (sub.cyaReadings && Object.keys(sub.cyaReadings).length > 0) ||
    photos.bleach?.length;

  let cyaHtml = '';
  if (sub.cyaReadings && Object.keys(sub.cyaReadings).length) {
    const rows = Object.entries(sub.cyaReadings).map(([k, v]) => {
      const label = k.replace('pool', 'Pool ');
      return dutyScaleHtml(`${label} CYA`, v, '', 'cya');
    }).join('');
    cyaHtml = `<div class="duty-scale-group"><h4>CYA Levels</h4>${rows}</div>`;
  }

  modal.innerHTML = `
    <div class="duty-report-modal-card">
      <div class="modal-header duty-report-modal-header">
        <h2>Cleanliness Report</h2>
        <button type="button" class="close" onclick="document.getElementById('dutyFormModal').style.display='none'">&times;</button>
      </div>
      <div class="duty-report-modal-scroll">
        <div class="duty-report-meta">
          <p><strong>Pool:</strong> ${esc(sub.pool)}</p>
          <p><strong>Submitted by:</strong> ${esc(sub.submitterEmail)}</p>
          <p><strong>Submitted:</strong> ${ts ? ts.toLocaleString() : '—'}</p>
        </div>

        ${photoSectionHtml('Deck', photos.deck)}
        ${photoSectionHtml('Pool', photos.pool)}
        ${photoSectionHtml('Skimmers', photos.skimmers)}
        ${photoSectionHtml('Damaged Equipment', photos.damaged)}
        ${photoSectionHtml('Bleach Feeders', photos.bleachFeeders)}
        ${photoSectionHtml('Fill Lines', photos.fillLines)}

        ${sub.damagedNotes ? `<div class="duty-report-notes"><strong>Damaged Equipment Notes:</strong><span>${esc(sub.damagedNotes)}</span></div>` : ''}
        ${sub.otherNotes ? `<div class="duty-report-notes"><strong>Other Notes:</strong><span>${esc(sub.otherNotes)}</span></div>` : ''}

        ${hasManagerData ? `
        <section class="duty-report-manager-panel">
          <h3>Managers Only</h3>
          ${photoSectionHtml('Bleach Barrels', photos.bleach)}
          ${dutyScaleHtml('Bleach Volume', sub.bleachVolume, '%', 'linear')}
          ${dutyScaleHtml('Muriatic Acid', sub.muriaticAcid, ' gal', 'acid')}
          ${dutyScaleHtml('Shock / Granular', sub.shockGranular, '%', 'linear')}
          ${cyaHtml}
        </section>` : ''}
      </div>
    </div>`;

  modal.style.display = 'flex';
}

// Photo modal for job form submissions
window.openPhotoModal = function(url) {
  let overlay = document.getElementById('photoViewOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'photoViewOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:10000;display:flex;align-items:center;justify-content:center;cursor:pointer;';
    overlay.addEventListener('click', () => overlay.style.display = 'none');
    const img = document.createElement('img');
    img.id = 'photoViewImg';
    img.style.cssText = 'max-width:90vw;max-height:90vh;object-fit:contain;box-shadow:0 0 20px rgba(0,0,0,0.5);';
    overlay.appendChild(img);
    document.body.appendChild(overlay);
  }
  document.getElementById('photoViewImg').src = url;
  overlay.style.display = 'flex';
};
