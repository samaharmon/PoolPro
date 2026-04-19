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
  writeBatch,
  deleteDoc,
  listenPools,
  signInWithEmailAndPassword,
  signOut,
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
  sessionTimeout: 'never',
  requirePasswordConfirm: true,
};
let securityIdleTimer = null;
let securityEventsBound = false;
let agreementGatePromise = null;
let sanitationEditing = false;
let sanitationMarketFilter = 'all';
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

function getPagePrefix() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  parts.pop();
  const subDirs = ['chem', 'Chem', 'training', 'Training', 'editor', 'Editor', 'main', 'Main', 'duties', 'Duties', 'employees', 'Employees', 'testing', 'Testing', 'resources', 'Resources'];
  const last = parts[parts.length - 1] || '';
  return subDirs.includes(last) ? '../' : '';
}

function injectResourcesMenuLinks() {
  const prefix = getPagePrefix();
  const isResourcesPage = /\/resources\/resources\.html$/i.test(window.location.pathname);

  document.querySelectorAll('.dropdown-menu').forEach((menu) => {
    if (menu.querySelector('[data-nav="resources"]')) return;
    const dutiesLink = menu.querySelector('[data-nav="duties"]');
    if (!dutiesLink) return;

    const link = document.createElement('a');
    link.href = isResourcesPage ? 'resources.html' : `${prefix}resources/resources.html`;
    link.className = `dropdown-item${isResourcesPage ? ' active-page' : ''}`;
    link.dataset.nav = 'resources';
    link.textContent = 'Resources';
    dutiesLink.insertAdjacentElement('afterend', link);
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
  if (table.matches('.dashboard-pool-table, .pool-table')) return '1200px';
  if (table.matches('.training-schedule-table')) return '980px';
  if (table.matches('.attendance-table, .test-rubric-table')) return '900px';
  if (table.matches('.employee-table')) return '760px';
  if (table.matches('.sanitation-table')) return '700px';
  if (table.matches('.resource-table')) return '760px';
  return '720px';
}

function wrapResponsiveTables(root = document) {
  const tables = root.querySelectorAll('table');
  tables.forEach((table) => {
    if (table.closest('.table-scroll-wrap')) return;
    if (table.closest('.rules-table')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'table-scroll-wrap';
    table.style.setProperty('--table-min-width', getResponsiveTableMinWidth(table));
    table.parentNode.insertBefore(wrapper, table);
    wrapper.appendChild(table);
    bindTableScrollShadow(wrapper);
  });
}

function updateTableScrollShadow(wrapper) {
  if (!wrapper) return;
  const hasOverflow = wrapper.scrollWidth > wrapper.clientWidth + 2;
  wrapper.classList.toggle('has-overflow-right', hasOverflow && (wrapper.scrollLeft + wrapper.clientWidth) < (wrapper.scrollWidth - 2));
  wrapper.classList.toggle('has-overflow-left', hasOverflow && wrapper.scrollLeft > 2);
  wrapper.classList.toggle('has-overflow', hasOverflow);
}

function bindTableScrollShadow(wrapper) {
  if (!wrapper || wrapper.dataset.shadowBound === 'true') return;
  wrapper.dataset.shadowBound = 'true';
  const refresh = () => updateTableScrollShadow(wrapper);
  wrapper.addEventListener('scroll', refresh, { passive: true });
  window.addEventListener('resize', refresh, { passive: true });
  requestAnimationFrame(refresh);
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

window.openSettings = function () {
  const modal = document.getElementById('settingsModal');
  const overlay = document.getElementById('settingsOverlay');
  document.querySelectorAll('.dropdown-menu.show').forEach(m => m.classList.remove('show'));
  if (overlay) {
    overlay.style.display = 'block';
    requestAnimationFrame(() => overlay.classList.add('visible'));
  }
  if (modal) {
    modal.style.display = 'block';
    requestAnimationFrame(() => modal.classList.add('visible'));
  }
};

window.closeSettings = function () {
  const modal = document.getElementById('settingsModal');
  const overlay = document.getElementById('settingsOverlay');
  if (modal) {
    modal.classList.remove('visible');
    setTimeout(() => { modal.style.display = 'none'; }, 250);
  }
  if (overlay) {
    overlay.classList.remove('visible');
    setTimeout(() => { overlay.style.display = 'none'; }, 250);
  }
};

// Close settings modal when clicking the overlay
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'settingsOverlay') {
    window.closeSettings();
  }
});

// ============================================================
// SUPERVISOR DASHBOARD
// ============================================================

window.goToDashboard = function () {
  document.querySelectorAll('.dropdown-menu.show').forEach(m => m.classList.remove('show'));
  const dashboard = document.getElementById('supervisorDashboard');
  if (dashboard) {
    const mainForm = document.getElementById('mainForm');
    if (mainForm) mainForm.style.display = 'none';
    dashboard.classList.add('show');
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
    localStorage.removeItem('trainingSupervisorLoggedIn');
    localStorage.removeItem('training_supervisor_logged_in_v1');
    localStorage.removeItem('chemlogTrainingSupervisorLoggedIn');
    sessionStorage.clear();
  } catch (_) { /* ignore */ }
  const _parts = window.location.pathname.split('/').filter(Boolean);
  _parts.pop();
  const _subDirs = ['chem', 'Chem', 'training', 'Training', 'editor', 'Editor', 'main', 'Main', 'duties', 'Duties', 'employees', 'Employees', 'testing', 'Testing', 'resources', 'Resources'];
  const _last = _parts[_parts.length - 1] || '';
  window.location.href = (_subDirs.includes(_last) ? '../' : '') + 'index.html';
};

function clearSupervisorLoginState() {
  try {
    localStorage.removeItem('loginToken');
    localStorage.removeItem('ChemLogSupervisor');
    localStorage.removeItem('chemlogRole');
    localStorage.removeItem('trainingSupervisorLoggedIn');
    localStorage.removeItem('training_supervisor_logged_in_v1');
    localStorage.removeItem('chemlogTrainingSupervisorLoggedIn');
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
  const storedRole = (sessionStorage.getItem('chemlogRole') || localStorage.getItem('chemlogRole') || '').toLowerCase();

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
  const expires = Date.now() + 10 * 24 * 60 * 60 * 1000; // 10 days
  localStorage.setItem('loginToken', JSON.stringify({ username: email, expires }));
  localStorage.setItem('ChemLogSupervisor', 'true');
  localStorage.setItem('trainingSupervisorLoggedIn', 'true');
  localStorage.setItem('training_supervisor_logged_in_v1', 'true');
  localStorage.setItem('chemlogTrainingSupervisorLoggedIn', 'true');
  localStorage.setItem('chemlogRole', 'supervisor');

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
  const subDirs = ['chem', 'training', 'editor', 'main', 'employees', 'testing', 'duties', 'resources'];
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
    const subDirs = ['chem', 'Chem', 'training', 'Training', 'editor', 'Editor', 'main', 'Main', 'duties', 'Duties', 'employees', 'Employees', 'testing', 'Testing', 'resources', 'Resources'];
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
  }, 250);
  const supSection = document.getElementById('supervisorNotifySection');
  if (supSection) supSection.style.display = 'none';
};

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

  // Refresh employee pool filter options when pools update
  populateEmployeePoolFilter(employeeMarketFilter);
  refreshResourceControls();
  renderResourcesPageTable();
  renderResourcesSettingsTable();
}

// ============================================================
// AUTH HELPERS
// ============================================================

function isSupervisor() {
  try {
    const storedRole = sessionStorage.getItem('chemlogRole') || localStorage.getItem('chemlogRole');
    if (storedRole === 'lifeguard') return false;
  } catch (_) { /* ignore */ }

  if (auth.currentUser) return true;
  try {
    const token = localStorage.getItem('loginToken');
    if (token) {
      const parsed = JSON.parse(token);
      if (parsed.expires && Date.now() < parsed.expires) return true;
    }
    if (localStorage.getItem('ChemLogSupervisor') === 'true') return true;
    if (localStorage.getItem('chemlogTrainingSupervisorLoggedIn') === 'true') return true;
  } catch (_) { /* ignore */ }
  return false;
}

// Show/hide supervisor-only dropdown items based on login state.
// Called on DOMContentLoaded and exported so training.js can re-call after login.
window.setupDropdownVisibility = function () {
  const sup = isSupervisor();
  ['dashboard', 'training-setup', 'employees', 'testing', 'settings'].forEach(nav => {
    document.querySelectorAll(`[data-nav="${nav}"]`).forEach(el => {
      el.style.display = sup ? '' : 'none';
    });
  });
  document.querySelectorAll('.dropdown-menu').forEach((m) => {
    m.classList.toggle('supervisor-active', sup);
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
  const subDirs = ['chem', 'training', 'editor', 'employees', 'testing', 'main', 'duties', 'resources', 'Chem', 'Training', 'Editor', 'Main', 'Duties', 'Employees', 'Testing', 'Resources'];
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

      // Check concern levels for all submitted pools
      const numPools = pool?.numPools || pool?.poolCount || 2;
      let allClear = true;
      for (let i = 0; i < numPools; i++) {
        const fields = poolFieldNames(i);
        const phVal = entry[fields.ph];
        const clVal = entry[fields.cl];
        if (phVal && getPhConcernLevel(poolName, i, phVal) !== 'none') { allClear = false; break; }
        if (clVal && getClConcernLevel(poolName, i, clVal) !== 'none') { allClear = false; break; }
      }

      // Show feedback modal with rule responses
      const feedbackModal = document.getElementById('feedbackModal');
      const modalContent = document.getElementById('modalContent');
      if (feedbackModal && modalContent) {
        const submitterName = [firstName, lastName].filter(Boolean).join(' ') || 'Unknown';
        const poolDoc = poolsCache.find(p => p.id === poolId);
        const method = sanitationSelections[poolId] || 'bleach';
        const poolRules = poolDoc ? normalizePoolRules(poolDoc) : [];
        const numPools = poolDoc?.numPools || poolDoc?.poolCount || 2;

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
          const rules = poolRules[i]?.[method];
          const poolLabel = i === 0 ? 'Main Pool' : i === 1 ? 'Secondary Pool' : `Pool ${i + 1}`;

          const phKey = phVal ? phToRuleKey(phVal) : null;
          const clKey = clVal ? clToRuleKey(clVal) : null;
          const phRule = phKey ? rules?.ph?.[phKey] : null;
          const clRule = clKey ? rules?.cl?.[clKey] : null;

          if (phRule?.response || clRule?.response) {
            html += `<div class="modal-pool-section">`;
            html += `<h4 class="modal-pool-label">${poolLabel}</h4>`;

            if (phRule?.response) {
              const isMajor = phRule.concernLevel === 'major' || phRule.concernLevel === 'red';
              checkboxIdx++;
              html += `<div class="modal-rule-item${isMajor ? ' modal-rule-major' : ''}">`;
              html += `<label class="checkbox-item">`;
              html += `<input type="checkbox" class="modal-rule-checkbox" id="rule_cb_${checkboxIdx}">`;
              html += `<span><strong>pH ${phVal}:</strong> ${phRule.response}</span>`;
              html += `</label>`;
              if (isMajor) {
                html += `<button type="button" class="notify-supervisor-btn" onclick="showSupervisorNotify()">Notify Supervisor</button>`;
                majorLines.push(`pH ${phVal}: ${phRule.response.replace(/<[^>]+>/g, '')}`);
              }
              html += `</div>`;
            }

            if (clRule?.response) {
              const isMajor = clRule.concernLevel === 'major' || clRule.concernLevel === 'red';
              checkboxIdx++;
              html += `<div class="modal-rule-item${isMajor ? ' modal-rule-major' : ''}">`;
              html += `<label class="checkbox-item">`;
              html += `<input type="checkbox" class="modal-rule-checkbox" id="rule_cb_${checkboxIdx}">`;
              html += `<span><strong>Cl ${clVal}:</strong> ${clRule.response}</span>`;
              html += `</label>`;
              if (isMajor) {
                html += `<button type="button" class="notify-supervisor-btn" onclick="showSupervisorNotify()">Notify Supervisor</button>`;
                majorLines.push(`Cl ${clVal}: ${clRule.response.replace(/<[^>]+>/g, '')}`);
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
      ['mainPoolPH', 'mainPoolCl', 'secondaryPoolPH', 'secondaryPoolCl'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      if (document.getElementById('poolLocation')) document.getElementById('poolLocation').value = '';
      updateVisiblePoolSections(2);

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
let sanitationSelections = {}; // poolId → 'bleach' | 'granular'

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
// Returns an array where index 0 = pool 1, each entry: { bleach: {ph, cl}, granular: {ph, cl} }
function normalizePoolRules(poolDoc) {
  // New format: poolDoc.rules.pools[i] = { bleach: {ph, cl}, granular: {ph, cl} }
  if (poolDoc.rules?.pools && Array.isArray(poolDoc.rules.pools) && poolDoc.rules.pools.length) {
    return poolDoc.rules.pools;
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
    pools.push({ bleach: { ph, cl }, granular: { ph, cl } });
  }
  return pools;
}

// Look up concern level for a pH value at a given pool facility + pool index (0-based)
function getPhConcernLevel(poolName, poolIdx, phValue) {
  const poolDoc = poolsCache.find(p => (p.name || p.id) === poolName);
  if (!poolDoc) return 'none';
  const method = sanitationSelections[poolDoc.id] || 'bleach';
  const poolRules = normalizePoolRules(poolDoc);
  const rules = poolRules[poolIdx]?.[method];
  if (!rules) return 'none';
  const key = phToRuleKey(phValue);
  return key ? (rules.ph?.[key]?.concernLevel || 'none') : 'none';
}

// Look up concern level for a Cl value at a given pool facility + pool index (0-based)
function getClConcernLevel(poolName, poolIdx, clValue) {
  const poolDoc = poolsCache.find(p => (p.name || p.id) === poolName);
  if (!poolDoc) return 'none';
  const method = sanitationSelections[poolDoc.id] || 'bleach';
  const poolRules = normalizePoolRules(poolDoc);
  const rules = poolRules[poolIdx]?.[method];
  if (!rules) return 'none';
  const key = clToRuleKey(clValue);
  return key ? (rules.cl?.[key]?.concernLevel || 'none') : 'none';
}

// Pool submission field names for each pool index (0-based)
function poolFieldNames(idx) {
  if (idx === 0) return { ph: 'mainPoolPH', cl: 'mainPoolCl' };
  if (idx === 1) return { ph: 'secondaryPoolPH', cl: 'secondaryPoolCl' };
  return { ph: `pool${idx + 1}PH`, cl: `pool${idx + 1}Cl` };
}

async function loadDashboardData() {
  const container = document.getElementById('dashboardContent');
  if (!container) return;
  container.innerHTML = '<p style="padding:16px;color:#666;">Loading…</p>';

  try {
    // Load sanitation method selections
    const sanSnap = await getDoc(doc(db, 'settings', 'sanitation'));
    sanitationSelections = sanSnap.exists() ? (sanSnap.data().pools || {}) : {};

    // Fetch all submissions, ordered newest first
    const q = query(collection(db, 'poolSubmissions'), orderBy('timestamp', 'desc'));
    const snap = await getDocs(q);
    allLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Keep only the most recent submission per poolLocation
    const seen = new Set();
    const recentByLocation = [];
    allLogs.forEach(log => {
      if (!log.poolLocation) return;
      if (seen.has(log.poolLocation)) return;
      seen.add(log.poolLocation);
      recentByLocation.push(log);
    });

    renderDashboard(recentByLocation);
  } catch (err) {
    console.error('[ChemLog] Error loading dashboard data:', err);
    if (container) container.innerHTML = '<p style="color:red;padding:16px;">Error loading data. Check console.</p>';
  }
}

function renderDashboard(recentLogs) {
  const container = document.getElementById('dashboardContent');
  if (!container) return;
  container.innerHTML = '';

  // Get selected markets from localStorage, fall back to all
  let selectedMarkets;
  try {
    const saved = JSON.parse(localStorage.getItem('chemlogMarkets') || '[]');
    selectedMarkets = saved.length ? saved : null;
  } catch (_) { selectedMarkets = null; }

  // Group pool docs by market
  const marketMap = {};
  poolsCache.forEach(pool => {
    const markets = Array.isArray(pool.markets) ? pool.markets
      : (pool.market ? [pool.market] : ['Other']);
    const primary = markets[0];
    if (!marketMap[primary]) marketMap[primary] = [];
    marketMap[primary].push(pool);
  });

  const marketsToShow = selectedMarkets
    ? selectedMarkets.filter(m => marketMap[m])
    : Object.keys(marketMap).sort();

  if (!marketsToShow.length) {
    container.innerHTML = '<p style="padding:16px;color:#666;">No markets selected. Enable markets in Settings.</p>';
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
          <th>Timestamp</th>
          <th>Respondent</th>
        </tr></thead>
      `;
      const tbody = document.createElement('tbody');

      // Sort facilities alphabetically, then render a row per facility
      const sortedPools = [...marketPools].sort((a, b) =>
        (a.name || '').localeCompare(b.name || ''));

      sortedPools.forEach(poolDoc => {
        const poolCount = poolDoc.numPools || poolDoc.poolCount || 1;
        if (poolCount <= i) return; // skip pools that don't have a pool at this index
        const facilityName = poolDoc.name || poolDoc.id;
        const log = recentLogs.find(l => l.poolLocation === facilityName);
        const fields = poolFieldNames(i);
        const phVal = log?.[fields.ph] || '';
        const clVal = log?.[fields.cl] || '';

        const phConcern = phVal ? getPhConcernLevel(facilityName, i, phVal) : 'none';
        const clConcern = clVal ? getClConcernLevel(facilityName, i, clVal) : 'none';

        // Item 7: Timestamp — flag if ≥3 hours old
        const tsDate = log?.timestamp?.toDate?.() || null;
        const tsStr = tsDate ? tsDate.toLocaleString() : '—';
        const isOld = tsDate && phVal && (Date.now() - tsDate.getTime() >= 3 * 60 * 60 * 1000);

        // Item 9: Consecutive major concern — check 2 most recent logs for this facility
        const facilityLogs = allLogs.filter(l => l.poolLocation === facilityName);
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
          <td>${facilityName}</td>
          <td class="${concernClass(phConcern)}">${phVal || '—'}</td>
          <td class="${concernClass(clConcern)}">${clVal || '—'}</td>
          <td></td>
          <td></td>
        `;

        if (hasConsecutiveMajor) {
          tr.style.outline = '4px solid #8b0000';
        }

        // Item 7: Timestamp cell
        const tsTd = tr.querySelectorAll('td')[3];
        if (phVal && tsDate) {
          if (isOld) {
            const bang = document.createElement('span');
            bang.textContent = '!!! ';
            bang.style.cssText = 'color:#8b0000;font-weight:bold;';
            tsTd.appendChild(bang);
          }
          tsTd.appendChild(document.createTextNode(tsStr));
        } else {
          tsTd.textContent = '—';
        }

        // Item 8: Respondent cell with tooltip
        const respondentTd = tr.querySelector('td:last-child');
        const firstName = log?.firstName || '';
        const lastName = log?.lastName || '';
        const fullName = [firstName, lastName].filter(Boolean).join(' ');
        if (fullName) {
          const empId = log?.employeeId || '';
          const empRecord = empId ? employeesData.find(e =>
            String(e.id || '').toLowerCase() === String(empId).toLowerCase() ||
            String(e.email || '').toLowerCase() === String(empId).toLowerCase()
          ) : null;
          const rawPhone = empRecord?.phone || '';
          const homePool = empRecord?.homePool || '—';
          const digits = rawPhone.replace(/\D/g, '');

          const nameWrapper = document.createElement('span');
          nameWrapper.className = 'dash-respondent-cell';

          const nameSpan = document.createElement('span');
          nameSpan.className = 'dash-respondent-name';
          nameSpan.textContent = fullName;
          if (digits.length >= 10) {
            nameSpan.style.cursor = 'pointer';
            nameSpan.addEventListener('click', () => {
              window.location.href = `sms:+1${digits.slice(-10)}`;
            });
          }

          const tooltip = document.createElement('div');
          tooltip.className = 'dash-respondent-tooltip';
          tooltip.innerHTML = `
            <strong>${fullName}</strong><br>
            ID: ${empId || '—'}<br>
            Home Pool: ${homePool}<br>
            Phone: ${rawPhone || '—'}
          `;

          nameWrapper.appendChild(nameSpan);
          nameWrapper.appendChild(tooltip);
          respondentTd.appendChild(nameWrapper);
        } else {
          respondentTd.textContent = '—';
        }

        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      panel.appendChild(table);
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
  } catch (err) {
    console.error('[ChemLog] Error saving employees:', err);
  }
}

async function loadSecuritySettings() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'security'));
    if (snap.exists()) {
      const data = snap.data() || {};
      securitySettings = {
        sessionTimeout: data.sessionTimeout || 'never',
        requirePasswordConfirm: data.requirePasswordConfirm !== false,
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

  if (!editBtn) {
    const controlsWrap = document.createElement('div');
    controlsWrap.className = 'toggle-btn';
    controlsWrap.innerHTML = `
      <div id="securityControls" class="sanitation-controls">
        <div class="sanitation-controls-thumb" style="transform:translateX(100%)"></div>
        <button type="button" class="editAndSave" id="securityEditBtn">Edit</button>
        <button type="button" class="editAndSave active" id="securitySaveBtn">Save</button>
      </div>
    `;
    securitySection.appendChild(controlsWrap);
    const newSaveBtn = controlsWrap.querySelector('#securitySaveBtn');
    if (newSaveBtn) {
      newSaveBtn.replaceWith(saveBtn);
      saveBtn.classList.add('active');
      saveBtn.classList.remove('submit-btn');
      saveBtn.classList.add('editAndSave');
      saveBtn.style.marginTop = '';
    }
    editBtn = controlsWrap.querySelector('#securityEditBtn');
  }

  const timeoutOptions = [
    { value: 'never', label: 'Never' },
    { value: '15', label: '15 minutes' },
    { value: '30', label: '30 minutes' },
    { value: '60', label: '60 minutes' },
    { value: '120', label: '2 hours' },
    { value: '180', label: '3 hours' },
    { value: '240', label: '4 hours' },
    { value: '360', label: '6 hours' },
    { value: '480', label: '8 hours' },
    { value: '720', label: '12 hours' },
    { value: '1440', label: '24 hours' },
  ];
  const existingOptionValues = new Set(Array.from(timeoutSelect.options).map((opt) => opt.value));
  timeoutOptions.forEach(({ value, label }) => {
    if (existingOptionValues.has(value)) return;
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    timeoutSelect.appendChild(opt);
  });
  requirePassCb.classList.add('market-filter-checkbox');
  requirePassCb.style.marginRight = '10px';

  timeoutSelect.value = securitySettings.sessionTimeout || 'never';
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

  if (!editBtn) return;
  if (editBtn.dataset.securityBound === 'true') return;
  editBtn.dataset.securityBound = 'true';

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
// RESOURCES
// ============================================================

let resourcesData = [];
let resourceEditingId = '';
let pendingResourceFile = null;
let resourcePageMarketFilter = 'all';
let resourcePagePoolFilter = 'all';
let resourceSettingsMarketFilter = 'all';
let resourceSettingsPoolFilter = 'all';

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
    <p class="section-subtitle">Upload and manage the documents available on the Resources page.</p>
    <div class="settings-row employee-file-row" style="margin-top: 20px;">
      <input type="file" id="resourceFileInput" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.ppt,.pptx,.jpg,.jpeg,.png" />
      <button type="button" id="resourceDeleteAllBtn" class="submit-btn danger-button employee-delete-inline-btn">Delete All Files</button>
    </div>
    <div class="settings-row resource-add-row">
      <div class="settings-field">
        <label for="resourceDocumentNameInput">Document Name</label>
        <input type="text" id="resourceDocumentNameInput" />
      </div>
      <div class="settings-field">
        <label for="resourceUploadDateInput">Upload Date</label>
        <input type="date" id="resourceUploadDateInput" />
      </div>
      <div class="settings-field settings-field-full">
        <label for="resourceDescriptionInput">Description</label>
        <input type="text" id="resourceDescriptionInput" />
      </div>
      <div class="settings-field">
        <label for="resourceMarketInput">Market</label>
        <select id="resourceMarketInput">
          <option value="">Select market</option>
        </select>
      </div>
      <div class="settings-field">
        <label for="resourcePoolInput">Pool</label>
        <select id="resourcePoolInput">
          <option value="">Select pool</option>
        </select>
      </div>
    </div>
    <div class="employee-add-btn-row">
      <button type="button" class="submit-btn button-shadow employee-action-btn" id="resourceAddBtn">Add</button>
    </div>
    <div class="training-filter-bar employee-filter-bar" id="resourceFilterBar" style="margin: 20px 0 4px;">
      <span class="filter-by-label">Filter By:</span>
      <select id="resourceMarketFilter" class="training-filter-select">
        <option value="all">All Markets</option>
      </select>
      <select id="resourcePoolFilter" class="training-filter-select">
        <option value="all">All Pools</option>
      </select>
    </div>
    <div id="resourceTableSection" class="sanitation-section overlay-disabled resource-table-section">
      <table class="employee-table resource-table resource-table-admin">
        <thead>
          <tr>
            <th>Document Name</th>
            <th>Upload Date</th>
            <th>Description</th>
            <th>Market</th>
            <th>Pool</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="resourceTableBody"></tbody>
      </table>
    </div>
  `;
  employeeSettings.insertAdjacentElement('afterend', section);
}

function getPoolName(pool) {
  return (pool?.name || pool?.id || '').toString().trim();
}

function getPoolMarket(poolName) {
  const match = poolsCache.find((pool) => getPoolName(pool) === poolName);
  if (!match) return '';
  const markets = Array.isArray(match.markets) ? match.markets : (match.market ? [match.market] : []);
  return markets[0] || '';
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
    pool: (docData.pool || '').toString().trim(),
    fileUrl: (docData.fileUrl || '').toString().trim(),
    fileName: (docData.fileName || '').toString().trim(),
    storagePath: (docData.storagePath || '').toString().trim(),
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
    .filter((item) => (market === 'all' ? true : item.market === market))
    .filter((item) => (pool === 'all' ? true : item.pool === pool))
    .sort(sortResourcesDescending);
}

function populateResourcePoolOptions(selectEl, market = 'all', includeAll = false) {
  if (!selectEl) return;
  const current = selectEl.value;
  const defaultLabel = includeAll ? 'All Pools' : 'Select pool';
  selectEl.innerHTML = `<option value="${includeAll ? 'all' : ''}">${defaultLabel}</option>`;

  const pools = (market === 'all' || !market)
    ? [...poolsCache]
    : poolsCache.filter((pool) => {
      const markets = Array.isArray(pool.markets) ? pool.markets : (pool.market ? [pool.market] : []);
      return markets.includes(market);
    });

  pools
    .map((pool) => getPoolName(pool))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .forEach((poolName) => {
      const option = document.createElement('option');
      option.value = poolName;
      option.textContent = poolName;
      selectEl.appendChild(option);
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
  populateResourceMarketOptions(document.getElementById('resourceMarketInput'), false);
  populateResourceMarketOptions(document.getElementById('resourceMarketFilter'), true);
  populateResourceMarketOptions(document.getElementById('resourcesMarketFilter'), true);

  populateResourcePoolOptions(document.getElementById('resourcePoolInput'), document.getElementById('resourceMarketInput')?.value || 'all', false);
  populateResourcePoolOptions(document.getElementById('resourcePoolFilter'), document.getElementById('resourceMarketFilter')?.value || 'all', true);
  populateResourcePoolOptions(document.getElementById('resourcesPoolFilter'), document.getElementById('resourcesMarketFilter')?.value || 'all', true);
}

function buildResourceRowCells(item, includeActions = false) {
  const nameHtml = item.fileUrl
    ? `<a href="${item.fileUrl}" target="_blank" rel="noopener">${item.documentName || item.fileName || 'Untitled document'}</a>`
    : (item.documentName || item.fileName || 'Untitled document');

  const row = `
    <td>${nameHtml}</td>
    <td>${formatResourceDate(item.uploadDate, item.uploadedAt)}</td>
    <td>${item.description || '—'}</td>
    <td>${item.market || '—'}</td>
    <td>${item.pool || '—'}</td>
    ${includeActions ? '<td class="actions-cell"></td>' : ''}
  `;
  return row;
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
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;font-style:italic;">No resources found.</td></tr>';
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
      const fileInput = document.getElementById('resourceFileInput');
      if (fileInput) fileInput.value = '';
      document.getElementById('resourceDocumentNameInput').value = item.documentName || '';
      document.getElementById('resourceUploadDateInput').value = item.uploadDate || '';
      document.getElementById('resourceDescriptionInput').value = item.description || '';
      document.getElementById('resourceMarketInput').value = item.market || '';
      populateResourcePoolOptions(document.getElementById('resourcePoolInput'), item.market || 'all', false);
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
}

function clearResourceForm() {
  resourceEditingId = '';
  pendingResourceFile = null;
  const ids = ['resourceDocumentNameInput', 'resourceUploadDateInput', 'resourceDescriptionInput'];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const fileInput = document.getElementById('resourceFileInput');
  if (fileInput) fileInput.value = '';
  const marketInput = document.getElementById('resourceMarketInput');
  const poolInput = document.getElementById('resourcePoolInput');
  if (marketInput) marketInput.value = '';
  if (poolInput) poolInput.value = '';
  const actionBtn = document.getElementById('resourceAddBtn');
  if (actionBtn) actionBtn.textContent = 'Add';
  document.getElementById('resourceTableSection')?.classList.add('overlay-disabled');
}

async function uploadResourceFile(file) {
  const safeName = `${Date.now()}_${String(file.name || 'resource').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const path = `resources/${safeName}`;
  const storage = getResourceStorage();
  const refObj = storageRef(storage, path);
  await uploadBytes(refObj, file);
  const fileUrl = await getDownloadURL(refObj);
  return {
    storagePath: path,
    fileUrl,
    fileName: file.name || safeName,
  };
}

async function deleteResourceRecord(item) {
  try {
    if (item.storagePath) {
      await deleteObject(storageRef(getResourceStorage(), item.storagePath)).catch(() => {});
    }
    await deleteDoc(doc(db, 'resourcesDocuments', item.id));
    await loadResourcesDocuments();
    if (resourceEditingId === item.id) clearResourceForm();
  } catch (err) {
    console.error('[PoolPro] Unable to remove resource:', err);
    alert('Unable to remove this document right now.');
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
  const fileInput = document.getElementById('resourceFileInput');
  const marketInput = document.getElementById('resourceMarketInput');
  const poolInput = document.getElementById('resourcePoolInput');
  const addBtn = document.getElementById('resourceAddBtn');
  const marketFilter = document.getElementById('resourceMarketFilter');
  const poolFilter = document.getElementById('resourcePoolFilter');
  const deleteAllBtn = document.getElementById('resourceDeleteAllBtn');

  if (!fileInput || !marketInput || !poolInput || !addBtn || !marketFilter || !poolFilter || !deleteAllBtn) return;
  if (addBtn.dataset.bound === 'true') return;
  addBtn.dataset.bound = 'true';

  fileInput.addEventListener('change', () => {
    pendingResourceFile = fileInput.files?.[0] || null;
  });

  marketInput.addEventListener('change', () => {
    populateResourcePoolOptions(poolInput, marketInput.value || 'all', false);
    poolInput.value = '';
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
    const uploadDate = document.getElementById('resourceUploadDateInput')?.value || '';
    const description = document.getElementById('resourceDescriptionInput')?.value.trim() || '';
    const market = marketInput.value || '';
    const pool = poolInput.value || '';

    if (!documentName || !uploadDate || !description || !market || !pool) {
      alert('Document Name, Upload Date, Description, Market, and Pool are required.');
      return;
    }

    const existing = resourceEditingId
      ? resourcesData.find((item) => item.id === resourceEditingId)
      : null;
    if (!existing && !pendingResourceFile) {
      alert('Choose a file before adding a resource.');
      return;
    }

    try {
      let fileMeta = existing ? {
        fileUrl: existing.fileUrl,
        fileName: existing.fileName,
        storagePath: existing.storagePath,
      } : null;

      if (pendingResourceFile) {
        fileMeta = await uploadResourceFile(pendingResourceFile);
        if (existing?.storagePath) {
          await deleteObject(storageRef(getResourceStorage(), existing.storagePath)).catch(() => {});
        }
      }

      const payload = normalizeResourceRecord({
        documentName,
        uploadDate,
        description,
        market,
        pool,
        fileUrl: fileMeta?.fileUrl || '',
        fileName: fileMeta?.fileName || '',
        storagePath: fileMeta?.storagePath || '',
        sortDate: new Date(`${uploadDate}T00:00:00`).getTime(),
        uploadedAt: existing?.uploadedAt || null,
      }, resourceEditingId);

      const targetRef = resourceEditingId
        ? doc(db, 'resourcesDocuments', resourceEditingId)
        : doc(collection(db, 'resourcesDocuments'));

      await setDoc(targetRef, {
        documentName: payload.documentName,
        uploadDate: payload.uploadDate,
        description: payload.description,
        market: payload.market,
        pool: payload.pool,
        fileUrl: payload.fileUrl,
        fileName: payload.fileName,
        storagePath: payload.storagePath,
        sortDate: payload.sortDate,
        uploadedAt: existing?.uploadedAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });

      clearResourceForm();
      await loadResourcesDocuments();
    } catch (err) {
      console.error('[PoolPro] Unable to save resource:', err);
      alert('Unable to save this document right now.');
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
        if (item.storagePath) {
          await deleteObject(storageRef(getResourceStorage(), item.storagePath)).catch(() => {});
        }
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
      document.querySelectorAll('#settingsModal .settings-section').forEach((other) => {
        if (other === section || other.dataset.accordionReady !== 'true') return;
        other.classList.add('collapsed');
      });
      section.classList.toggle('collapsed', !isCollapsed);
    });
  });
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
  table.innerHTML = '<thead><tr><th>Market</th><th>Pool</th><th>Bleach</th><th>Granular</th></tr></thead>';
  const tbody = document.createElement('tbody');

  rows
    .filter(({ market }) => sanitationMarketFilter === 'all' || market === sanitationMarketFilter)
    .forEach(({ market, pool }) => {
      const saved = sanitationData[pool.id] || 'bleach';
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${market}</td><td>${pool.name || pool.id}</td>`;

      const bleachCb = document.createElement('input');
      bleachCb.type = 'checkbox';
      bleachCb.className = 'market-filter-checkbox';
      bleachCb.checked = saved === 'bleach';
      bleachCb.disabled = !sanitationEditing;

      const granularCb = document.createElement('input');
      granularCb.type = 'checkbox';
      granularCb.className = 'market-filter-checkbox';
      granularCb.checked = saved === 'granular';
      granularCb.disabled = !sanitationEditing;

      const updateSelection = (method) => {
        sanitationData[pool.id] = method;
        bleachCb.checked = method === 'bleach';
        granularCb.checked = method === 'granular';
      };

      bleachCb.addEventListener('change', () => updateSelection('bleach'));
      granularCb.addEventListener('change', () => updateSelection('granular'));

      const bleachTd = document.createElement('td');
      bleachTd.style.textAlign = 'center';
      bleachTd.appendChild(bleachCb);
      const granularTd = document.createElement('td');
      granularTd.style.textAlign = 'center';
      granularTd.appendChild(granularCb);
      tr.appendChild(bleachTd);
      tr.appendChild(granularTd);
      tbody.appendChild(tr);
    });

  table.appendChild(tbody);
  tableWrap.appendChild(table);
  container.appendChild(tableWrap);
  wrapResponsiveTables(container);

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

// MARKET SECTION — Edit/Save toggle with overlay
// ============================================================

function setupMarketEditSave() {
  const editBtn = document.getElementById('marketEditBtn');
  const saveBtn = document.getElementById('marketSaveBtn');
  const section = document.getElementById('marketSection');
  if (!editBtn || !saveBtn || !section) return;

  // Start in read-only mode
  section.classList.add('overlay-disabled');

  editBtn.addEventListener('click', () => {
    section.classList.remove('overlay-disabled');
    editBtn.classList.remove('active');
    saveBtn.classList.add('active');
    editBtn.disabled = true;
    saveBtn.disabled = false;
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
      const mainForm = document.getElementById('mainForm');
      if (mainForm) mainForm.style.display = 'none';
      dashboard.classList.add('show');
      loadDashboardData();
    }
  }
}

// ============================================================
// BOOT — wire everything up on DOMContentLoaded
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  mountUnifiedFooter();
  normalizeSharedHeaderCopy();
  injectResourcesMenuLinks();
  ensureResourcesSettingsSection();
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
    const role = sessionStorage.getItem('chemlogRole') || localStorage.getItem('chemlogRole');
    if (user) {
      if (role === 'lifeguard') {
        signOut(auth).catch(() => {});
        window.setupDropdownVisibility();
        return;
      }
      // Enforce fresh email auth every 10 days.
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

  // Chemistry form submission
  setupChemForm();

  // Employee management
  await loadSecuritySettings();
  loadEmployees();
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
  if (dashboard && dashboard.classList.contains('show') && isSupervisor()) {
    loadDashboardData();
  }

  // Supervisor Dashboard tab switching (Pool Chemistry vs Cleanliness Reports)
  const dashTabs = document.querySelectorAll('[data-dash-tab]');
  dashTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      dashTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const which = tab.dataset.dashTab;
      const chemPanel = document.getElementById('dashboardContent');
      const jobPanel = document.getElementById('jobFormsContent');
      if (which === 'chemistry') {
        if (chemPanel) chemPanel.style.display = '';
        if (jobPanel) jobPanel.style.display = 'none';
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

  if (!submissions.length) {
    container.innerHTML = '<p style="padding:16px;color:#666;">No cleanliness reports yet.</p>';
    return;
  }

  // Get selected markets
  let selectedMarkets;
  try {
    const saved = JSON.parse(localStorage.getItem('chemlogMarkets') || '[]');
    selectedMarkets = saved.length ? saved : null;
  } catch (_) { selectedMarkets = null; }

  // Group by market then pool
  const marketMap = {};
  poolsCache.forEach(pool => {
    const markets = Array.isArray(pool.markets) ? pool.markets : (pool.market ? [pool.market] : ['Other']);
    const primary = markets[0];
    if (!marketMap[primary]) marketMap[primary] = [];
    marketMap[primary].push(pool.name || pool.id);
  });

  const marketsToShow = selectedMarkets
    ? selectedMarkets.filter(m => marketMap[m])
    : Object.keys(marketMap).sort();

  // Filter bar
  const filterBar = document.createElement('div');
  filterBar.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:20px;flex-wrap:wrap;';
  filterBar.innerHTML = `<span class="filter-by-label">Filter By:</span>
    <select id="jobMarketFilter" class="training-filter-select"><option value="all">All Markets</option></select>
    <select id="jobPoolFilter" class="training-filter-select"><option value="all">All Pools</option></select>`;
  container.appendChild(filterBar);

  const marketSel = filterBar.querySelector('#jobMarketFilter');
  const poolSel = filterBar.querySelector('#jobPoolFilter');
  marketsToShow.forEach(m => { const o = document.createElement('option'); o.value = m; o.textContent = m; marketSel.appendChild(o); });

  const tablesWrap = document.createElement('div');
  container.appendChild(tablesWrap);

  function renderTables() {
    tablesWrap.innerHTML = '';
    const mFilter = marketSel.value;
    const pFilter = poolSel.value;

    const toShow = mFilter === 'all' ? marketsToShow : [mFilter];
    toShow.forEach(market => {
      const pools = marketMap[market] || [];
      if (pFilter !== 'all' && !pools.includes(pFilter)) return;

      const section = document.createElement('div');
      section.className = 'dashboard-market-section';
      const h2 = document.createElement('h2');
      h2.className = 'dashboard-market-heading';
      h2.textContent = market;
      section.appendChild(h2);

      const poolsToRender = pFilter === 'all' ? pools : pools.filter(p => p === pFilter);
      poolsToRender.forEach(poolName => {
        const poolSubs = submissions.filter(s => s.pool === poolName);
        if (!poolSubs.length) return;

        const h3 = document.createElement('h3');
        h3.style.cssText = 'font-size:1rem;color:#69140e;margin:16px 0 8px;border-bottom:1px solid #ccc;padding-bottom:4px;';
        h3.textContent = poolName;
        section.appendChild(h3);

        const table = document.createElement('table');
        table.className = 'data-table dashboard-pool-table';
        table.style.width = '100%';
        table.innerHTML = `<thead><tr>
          <th>Submitted By</th>
          <th>Photos</th>
          <th>Notes</th>
          <th>Submitted</th>
        </tr></thead>`;
        const tbody = document.createElement('tbody');

        poolSubs.forEach(sub => {
          const tr = document.createElement('tr');
          const ts = sub.timestamp?.toDate ? sub.timestamp.toDate() : null;
          const timeStr = ts ? ts.toLocaleString() : '—';
          const photoGroups = sub.photos && typeof sub.photos === 'object'
            ? Object.values(sub.photos).flat()
            : [];
          const photoCells = photoGroups.map((p) =>
            `<a href="${p.url}" target="_blank" rel="noopener">
               <img src="${p.url}" alt="Photo" style="width:60px;height:60px;object-fit:cover;cursor:pointer;border:1px solid #ccc;margin:2px;"
                 onclick="event.preventDefault();openPhotoModal('${p.url}')" />
             </a>`
          ).join('');
          const noteParts = [
            sub.damagedNotes,
            sub.otherNotes
          ].filter(Boolean);
          tr.innerHTML = `<td>${sub.submitterEmail || '—'}</td>
            <td style="white-space:nowrap;">${photoCells || '—'}</td>
            <td>${noteParts.join('<br><br>') || '—'}</td>
            <td style="white-space:nowrap;">${timeStr}</td>`;
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        section.appendChild(table);
      });
      tablesWrap.appendChild(section);
    });
  }

  renderTables();
  marketSel.addEventListener('change', () => {
    poolSel.innerHTML = '<option value="all">All Pools</option>';
    const pools = marketSel.value === 'all' ? Object.values(marketMap).flat() : (marketMap[marketSel.value] || []);
    [...new Set(pools)].sort().forEach(p => { const o = document.createElement('option'); o.value = p; o.textContent = p; poolSel.appendChild(o); });
    renderTables();
  });
  poolSel.addEventListener('change', renderTables);
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
